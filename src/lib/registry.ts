/**
 * Direct reads against the ERC-8004 Identity Registry on BSC.
 *
 * Why this exists: the 8004scan API key is capped at the anonymous tier
 * (10 req/min, 100/day), which puts a full census ~182 days away. The registry
 * is an ERC-721, so we enumerate it ourselves from public RPC — free, fast
 * (~37 reads/sec via multicall), and with no vendor dependency.
 *
 * That independence is also the honest position: our own argument is that data
 * living only in one indexer's database is not the ecosystem's data.
 *
 * Verified on 2026-08-18:
 *   name() = "AgentIdentity", symbol() = "AGENT"
 *   totalSupply() REVERTS — not ERC721Enumerable, so the id ceiling is found
 *   by exponential + binary search over ownerOf().
 */
import { createPublicClient, http, parseAbi, fallback, type PublicClient } from "viem";
import { bsc } from "viem/chains";

export const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" as const;

const RPCS = (process.env.BSC_RPCS ??
  [
    "https://bsc-rpc.publicnode.com",
    "https://binance.llamarpc.com",
    "https://bsc-dataseed1.bnbchain.org",
    "https://bsc-dataseed2.bnbchain.org",
    "https://bsc-dataseed3.bnbchain.org",
    "https://1rpc.io/bnb",
  ].join(",")
).split(",").map((s) => s.trim()).filter(Boolean);

export const registryAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);

export function makeClient(): PublicClient {
  return createPublicClient({
    chain: bsc,
    transport: fallback(
      RPCS.map((u) => http(u, { timeout: 25_000, retryCount: 2, retryDelay: 400 })),
      { rank: false },
    ),
    batch: { multicall: { wait: 24, batchSize: 1024 } },
  }) as PublicClient;
}

/** True when the token exists (ownerOf does not revert). */
async function exists(client: PublicClient, id: bigint): Promise<boolean> {
  try {
    await client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [id] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Highest minted tokenId. Exponential probe to bracket, then binary search.
 * Assumes ids are densely allocated from 1 upward, which matches an
 * incrementing registry; gaps from burns are tolerated by the final scan.
 */
export async function findMaxTokenId(client: PublicClient, hint = 1n): Promise<bigint> {
  let lo = 0n;
  let hi = hint > 0n ? hint : 1n;

  while (await exists(client, hi)) {
    lo = hi;
    hi *= 2n;
    if (hi > 100_000_000n) break;
  }
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (await exists(client, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export type RegistryRow = {
  tokenId: string;
  owner: string | null;
  tokenURI: string | null;
  uriScheme: "https" | "http" | "ipfs" | "data" | "empty" | "other";
};

function schemeOf(uri: string | null): RegistryRow["uriScheme"] {
  if (!uri || !uri.trim()) return "empty";
  const u = uri.trim().toLowerCase();
  if (u.startsWith("https:")) return "https";
  if (u.startsWith("http:")) return "http";
  if (u.startsWith("ipfs:")) return "ipfs";
  if (u.startsWith("data:")) return "data";
  return "other";
}

/** Batch-read owner + tokenURI for a contiguous id range. */
export async function readRange(client: PublicClient, ids: bigint[]): Promise<RegistryRow[]> {
  const [owners, uris] = await Promise.all([
    client.multicall({
      contracts: ids.map((id) => ({ address: REGISTRY, abi: registryAbi, functionName: "ownerOf" as const, args: [id] })),
      allowFailure: true,
    }),
    client.multicall({
      contracts: ids.map((id) => ({ address: REGISTRY, abi: registryAbi, functionName: "tokenURI" as const, args: [id] })),
      allowFailure: true,
    }),
  ]);

  return ids.map((id, i) => {
    const o = owners[i];
    const u = uris[i];
    const owner = o?.status === "success" ? String(o.result) : null;
    const tokenURI = u?.status === "success" ? String(u.result) : null;
    return { tokenId: id.toString(), owner, tokenURI, uriScheme: schemeOf(tokenURI) };
  });
}

// ── registration file ──────────────────────────────────────────────────────

/** ERC-8004 registration file. All fields optional in practice — agents lie. */
export type RegistrationFile = {
  type?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: { name?: string; endpoint?: string; version?: string; skills?: unknown[]; domains?: unknown[] }[];
  x402Support?: boolean;
  active?: boolean;
  registrations?: { agentId?: number; agentRegistry?: string }[];
  supportedTrust?: string[];
};

export type ResolvedRegistration =
  | { ok: true; source: "data" | "http" | "ipfs"; file: RegistrationFile; rawBytes: number }
  | { ok: false; source: "data" | "http" | "ipfs" | "empty" | "other"; error: string };

const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

/**
 * Resolve a tokenURI to its registration file.
 *
 * `data:` URIs resolve with no network at all — 13.5% of a sampled batch, so
 * this is a meaningful shortcut, not an edge case.
 */
export async function resolveRegistration(uri: string | null, timeoutMs = 8000): Promise<ResolvedRegistration> {
  if (!uri || !uri.trim()) return { ok: false, source: "empty", error: "no tokenURI" };
  const u = uri.trim();

  if (u.toLowerCase().startsWith("data:")) {
    try {
      const comma = u.indexOf(",");
      if (comma < 0) throw new Error("malformed data URI");
      const meta = u.slice(5, comma).toLowerCase();
      const payload = u.slice(comma + 1);
      const text = meta.includes("base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      return { ok: true, source: "data", file: JSON.parse(text) as RegistrationFile, rawBytes: text.length };
    } catch (e: any) {
      return { ok: false, source: "data", error: String(e?.message ?? e).slice(0, 140) };
    }
  }

  const urls: string[] = [];
  let source: "http" | "ipfs" = "http";
  if (u.toLowerCase().startsWith("ipfs://")) {
    source = "ipfs";
    const cid = u.slice(7).replace(/^ipfs\//, "");
    urls.push(...IPFS_GATEWAYS.map((g) => g + cid));
  } else if (/^https?:/i.test(u)) {
    urls.push(u);
  } else {
    return { ok: false, source: "other", error: `unsupported scheme: ${u.slice(0, 40)}` };
  }

  let lastErr = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "gebo/0.2 (+registration resolver)" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const text = await res.text();
      try {
        return { ok: true, source, file: JSON.parse(text) as RegistrationFile, rawBytes: text.length };
      } catch {
        lastErr = "invalid JSON";
        continue;
      }
    } catch (e: any) {
      lastErr = String(e?.cause?.code ?? e?.message ?? e).slice(0, 120);
    }
  }
  return { ok: false, source, error: lastErr || "unreachable" };
}

/** Extract callable endpoints from a registration file's services[]. */
export function endpointsFromRegistration(file: RegistrationFile) {
  const out: { kind: "a2a" | "mcp" | "web"; url: string; version?: string }[] = [];
  for (const s of file.services ?? []) {
    const name = (s?.name ?? "").toString().trim().toLowerCase();
    const ep = (s?.endpoint ?? "").toString().trim();
    if (!ep) continue;
    if (name === "a2a") out.push({ kind: "a2a", url: ep, version: s.version });
    else if (name === "mcp") out.push({ kind: "mcp", url: ep, version: s.version });
    else if (name === "web") out.push({ kind: "web", url: ep, version: s.version });
  }
  return out;
}
