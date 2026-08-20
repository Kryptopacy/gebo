/**
 * Full registry census — reads the ERC-8004 Identity Registry directly.
 *
 * Why not the API: the 8004scan key is capped at the anonymous tier
 * (10 req/min, 100/day), which puts a 258k-agent census ~182 days out. Chain
 * reads via multicall run at ~37/sec for free, so the whole registry is ~2h.
 *
 * Two phases, separated deliberately:
 *
 *   PHASE 1 (chain)  ownerOf + tokenURI for every token. Cheap, fast, no HTTP.
 *                    Gives the real denominator: how many agents even declare
 *                    a resolvable metadata pointer.
 *
 *   PHASE 2 (resolve) Fetch registration files and extract services[] endpoints.
 *                    `data:` URIs cost nothing (13.5% of a sampled batch).
 *                    Remote fetches are politeness-limited PER HOST, because
 *                    operator concentration means a naive run would hammer a
 *                    handful of domains.
 *
 * Resumable: appends NDJSON, skips tokens already recorded.
 *
 * Usage:
 *   npx tsx scripts/registry-census.ts              # chain phase, all tokens
 *   npx tsx scripts/registry-census.ts --limit 5000 # bounded run
 *   npx tsx scripts/registry-census.ts --resolve     # also fetch registrations
 */
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import {
  makeClient, findMaxTokenId, readRange, resolveRegistration,
  endpointsFromRegistration, REGISTRY, type RegistryRow,
} from "../src/lib/registry.ts";
import { lintUrl } from "../src/lib/lint.ts";
import { registrableDomain } from "../src/lib/operator.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d: number) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};

const OUT = "data/registry-bsc.ndjson";
const BATCH = opt("--batch", 200);
const LIMIT = opt("--limit", 0);
const DO_RESOLVE = flag("--resolve");
/**
 * Resolve only `data:` URIs, which decode from calldata with zero network.
 * IPFS gateways are the bottleneck in a full run (three gateways deep with
 * timeouts each), so a first pass that skips remote fetches gets complete
 * coverage in ~2h instead of ~18h. Remote resolution runs as a second pass.
 */
const LOCAL_ONLY = flag("--local-only");
const RESOLVE_CONCURRENCY = 12;

mkdirSync("data", { recursive: true });

const done = new Set<string>();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).tokenId); } catch { /* partial line */ }
  }
  console.log(`  resuming — ${done.size.toLocaleString()} tokens already recorded`);
}

const client = makeClient();

console.log(`\n  registry ${REGISTRY} · BNB Smart Chain (56)`);
process.stdout.write("  locating highest tokenId… ");
const max = await findMaxTokenId(client, 260_000n);
console.log(`${max.toLocaleString()}`);

const target = LIMIT > 0 ? Math.min(LIMIT, Number(max)) : Number(max);
console.log(`  censusing ${target.toLocaleString()} tokens in batches of ${BATCH}`);
console.log(`  registration resolution: ${DO_RESOLVE ? (LOCAL_ONLY ? "data: URIs only (no network)" : "ON") : "OFF (chain phase only)"}\n`);

// Per-host politeness. Operator concentration means a naive run would hammer
// a handful of domains hard enough to look like an attack.
const hostGate = new Map<string, number>();
async function politeHostWait(host: string, minGapMs = 250) {
  const last = hostGate.get(host) ?? 0;
  const wait = last + minGapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  hostGate.set(host, Date.now());
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

type CensusRow = RegistryRow & {
  resolved?: boolean;
  resolveError?: string | null;
  regName?: string | null;
  regActive?: boolean | null;
  x402?: boolean | null;
  supportedTrust?: string[] | null;
  endpoints?: { kind: string; url: string; version?: string; host: string | null; operator: string | null; fatal: string[] }[];
  callable?: boolean;
  readAt: string;
};

const tally = {
  tokens: 0,
  uriScheme: {} as Record<string, number>,
  resolved: 0,
  resolveFailed: 0,
  callable: 0,
  fatalLint: 0,
};

const t0 = Date.now();

for (let start = 1; start <= target; start += BATCH) {
  const ids: bigint[] = [];
  for (let i = start; i < start + BATCH && i <= target; i++) {
    if (!done.has(String(i))) ids.push(BigInt(i));
  }
  if (!ids.length) continue;

  let rows: RegistryRow[];
  try {
    rows = await readRange(client, ids);
  } catch (e: any) {
    console.log(`    ! batch ${start} failed: ${String(e?.shortMessage ?? e?.message).slice(0, 90)} — skipping`);
    continue;
  }

  let out: CensusRow[] = rows.map((r) => ({ ...r, readAt: new Date().toISOString() }));

  if (DO_RESOLVE) {
    out = await mapLimit(out, RESOLVE_CONCURRENCY, async (row) => {
      if (row.uriScheme === "empty") {
        return { ...row, resolved: false, resolveError: "no tokenURI", callable: false };
      }
      if (LOCAL_ONLY && row.uriScheme !== "data") {
        return { ...row, resolved: false, resolveError: "deferred: remote fetch", callable: false };
      }
      if (row.uriScheme === "https" || row.uriScheme === "http") {
        try { await politeHostWait(new URL(row.tokenURI!).hostname); } catch { /* ignore */ }
      }
      const res = await resolveRegistration(row.tokenURI);
      if (!res.ok) {
        return { ...row, resolved: false, resolveError: res.error, callable: false };
      }
      const eps = endpointsFromRegistration(res.file).map((e) => {
        let host: string | null = null;
        let operator: string | null = null;
        try {
          host = new URL(e.url).hostname;
          operator = registrableDomain(host);
        } catch { /* unparseable */ }
        return {
          ...e,
          host,
          operator,
          fatal: lintUrl(e.url).filter((d) => d.severity === "fatal").map((d) => d.code),
        };
      });
      return {
        ...row,
        resolved: true,
        resolveError: null,
        regName: res.file.name ?? null,
        regActive: res.file.active ?? null,
        x402: res.file.x402Support ?? null,
        supportedTrust: res.file.supportedTrust ?? null,
        endpoints: eps,
        callable: eps.some((e) => (e.kind === "a2a" || e.kind === "mcp") && e.fatal.length === 0),
      };
    });
  }

  appendFileSync(OUT, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  for (const r of out) {
    tally.tokens++;
    tally.uriScheme[r.uriScheme] = (tally.uriScheme[r.uriScheme] ?? 0) + 1;
    if (r.resolved) tally.resolved++;
    else if (DO_RESOLVE) tally.resolveFailed++;
    if (r.callable) tally.callable++;
    if (r.endpoints?.some((e) => e.fatal.length)) tally.fatalLint++;
  }

  const mins = (Date.now() - t0) / 60_000;
  const rate = tally.tokens / Math.max(mins, 0.01);
  const pctDone = ((start + BATCH) / target) * 100;
  console.log(
    `    ${Math.min(start + BATCH - 1, target).toLocaleString()}/${target.toLocaleString()}` +
    ` (${pctDone.toFixed(1)}%)  ${rate.toFixed(0)}/min` +
    (DO_RESOLVE ? `  resolved=${tally.resolved} callable=${tally.callable} fatal=${tally.fatalLint}` : ""),
  );
}

console.log(`\n  CENSUS DONE — ${tally.tokens.toLocaleString()} tokens in ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
console.log(`  uri schemes: ${JSON.stringify(tally.uriScheme)}`);
if (DO_RESOLVE) {
  console.log(`  registrations resolved: ${tally.resolved.toLocaleString()}  failed: ${tally.resolveFailed.toLocaleString()}`);
  console.log(`  callable (A2A/MCP, lint-clean): ${tally.callable.toLocaleString()}`);
  console.log(`  with a fatal endpoint defect:   ${tally.fatalLint.toLocaleString()}`);
}
console.log(`  written: ${OUT}\n`);
