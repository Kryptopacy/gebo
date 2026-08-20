/**
 * Verify the ERC-8004 Identity Registry on BSC can be read directly.
 *
 * Why: the 8004scan key is stuck on the anonymous tier (10/min, 100/day), which
 * makes a 18k-agent census via their API infeasible (~182 days). The registry
 * is an ERC-721, so we can enumerate it ourselves from public RPC for free.
 *
 * This also removes a single-vendor dependency, which is consistent with the
 * project's own argument that data held only in one indexer's database is not
 * the ecosystem's data.
 *
 * Registry: 0x8004a169fb4a3325136eb29fa0ceb6d2e539a432 (from 8004scan's
 * contract_address field on every BSC agent).
 */
import "dotenv/config";
import { createPublicClient, http, parseAbi, fallback } from "viem";
import { bsc } from "viem/chains";

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" as const;

const RPCS = [
  "https://bsc-rpc.publicnode.com",
  "https://binance.llamarpc.com",
  "https://bsc-dataseed1.bnbchain.org",
  "https://bsc-dataseed2.bnbchain.org",
  "https://1rpc.io/bnb",
];

const pub = createPublicClient({
  chain: bsc,
  transport: fallback(RPCS.map((u) => http(u, { timeout: 20_000, retryCount: 2 }))),
  batch: { multicall: { wait: 32, batchSize: 512 } },
});

// ERC-721 + URIStorage, plus the ERC-8004 additions we care about.
const abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
]);

console.log(`\n  registry: ${REGISTRY}`);
console.log(`  chain   : BSC (56)\n`);

const head = await pub.getBlockNumber();
console.log(`  head block: ${head.toLocaleString()}`);

// --- basic ERC-721 surface -------------------------------------------------
for (const fn of ["name", "symbol", "totalSupply"] as const) {
  try {
    const v = await pub.readContract({ address: REGISTRY, abi, functionName: fn });
    console.log(`  ${fn.padEnd(12)} = ${typeof v === "bigint" ? v.toLocaleString() : String(v)}`);
  } catch (e: any) {
    console.log(`  ${fn.padEnd(12)} = UNSUPPORTED (${String(e?.shortMessage ?? e?.message).slice(0, 80)})`);
  }
}

// --- can we read a known agent? -------------------------------------------
// 269589 was returned by 8004scan as a live BSC agent.
const KNOWN = 269589n;
console.log(`\n  reading known agent ${KNOWN}:`);
for (const fn of ["ownerOf", "tokenURI", "getAgentWallet"] as const) {
  try {
    const v = await pub.readContract({ address: REGISTRY, abi, functionName: fn, args: [KNOWN] });
    const s = String(v);
    console.log(`    ${fn.padEnd(16)} = ${s.length > 160 ? s.slice(0, 160) + "…" : s}`);
  } catch (e: any) {
    console.log(`    ${fn.padEnd(16)} = ERR ${String(e?.shortMessage ?? e?.message).slice(0, 90)}`);
  }
}

// --- multicall batch read: how fast can we enumerate? ---------------------
console.log(`\n  multicall batch test — 200 sequential tokenIds:`);
const ids = Array.from({ length: 200 }, (_, i) => KNOWN - BigInt(i));
const t0 = Date.now();
const results = await pub.multicall({
  contracts: ids.map((id) => ({ address: REGISTRY, abi, functionName: "tokenURI" as const, args: [id] })),
  allowFailure: true,
});
const ms = Date.now() - t0;
const ok = results.filter((r) => r.status === "success").length;
console.log(`    ${ok}/200 succeeded in ${ms} ms  (${((200 / ms) * 1000).toFixed(0)} reads/sec)`);
console.log(`    projected time for 258,000 tokenURIs: ${((258_000 / (200 / (ms / 1000))) / 60).toFixed(1)} min`);

// --- what do the URIs look like? -----------------------------------------
console.log(`\n  URI scheme distribution in this batch:`);
const schemes = new Map<string, number>();
const examples = new Map<string, string>();
for (const r of results) {
  if (r.status !== "success") continue;
  const uri = String(r.result);
  const scheme = uri.startsWith("data:") ? "data:" : uri.split(":")[0] + ":";
  schemes.set(scheme, (schemes.get(scheme) ?? 0) + 1);
  if (!examples.has(scheme)) examples.set(scheme, uri.slice(0, 120));
}
for (const [s, n] of [...schemes].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${s.padEnd(10)} e.g. ${examples.get(s)}`);
}
console.log("");
