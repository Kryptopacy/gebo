/**
 * Analyse the registry census — chain-wide, first-party numbers.
 *
 * Streams data/registry-bsc.ndjson (125 MB+) line by line rather than loading
 * it, so this stays flat in memory regardless of census size.
 *
 * These figures replace the 120-agent sample in docs/MEASUREMENTS.md with
 * near-complete coverage of the ERC-8004 Identity Registry on BSC.
 */
import "dotenv/config";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const FILE = "data/registry-bsc.ndjson";

type Row = {
  tokenId: string;
  owner: string | null;
  tokenURI: string | null;
  uriScheme: string;
  resolved?: boolean;
  resolveError?: string | null;
  regName?: string | null;
  regActive?: boolean | null;
  x402?: boolean | null;
  supportedTrust?: string[] | null;
  endpoints?: { kind: string; url: string; host: string | null; operator: string | null; fatal: string[] }[];
  callable?: boolean;
};

const inc = <K extends string | number>(m: Map<K, number>, k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

let rows = 0;
let maxToken = 0;
const uriScheme = new Map<string, number>();
const owners = new Map<string, number>();
let resolved = 0;
let resolveDeferred = 0;
let resolveFailed = 0;
const resolveErrors = new Map<string, number>();

let withEndpoints = 0;
let callable = 0;
const endpointKinds = new Map<string, number>();
const operators = new Map<string, number>();
const operatorCallable = new Map<string, number>();
const fatalCodes = new Map<string, number>();
let withFatal = 0;
let x402 = 0;
let declaredActive = 0;
const trustModels = new Map<string, number>();
let namedAgents = 0;

const rl = createInterface({ input: createReadStream(FILE, { encoding: "utf8" }), crlfDelay: Infinity });

for await (const line of rl) {
  if (!line.trim()) continue;
  let r: Row;
  try { r = JSON.parse(line); } catch { continue; }
  rows++;

  const t = Number(r.tokenId);
  if (t > maxToken) maxToken = t;

  inc(uriScheme, r.uriScheme ?? "unknown");
  if (r.owner) inc(owners, r.owner.toLowerCase());

  if (r.resolved) resolved++;
  else if (r.resolveError === "deferred: remote fetch") resolveDeferred++;
  else { resolveFailed++; inc(resolveErrors, (r.resolveError ?? "unknown").slice(0, 46)); }

  if (r.regName) namedAgents++;
  if (r.x402) x402++;
  if (r.regActive) declaredActive++;
  for (const tm of r.supportedTrust ?? []) inc(trustModels, String(tm));

  const eps = r.endpoints ?? [];
  if (eps.length) withEndpoints++;
  if (r.callable) callable++;

  let rowHasFatal = false;
  for (const e of eps) {
    inc(endpointKinds, e.kind);
    if (e.operator) {
      inc(operators, e.operator);
      if (r.callable) inc(operatorCallable, e.operator);
    }
    for (const f of e.fatal ?? []) { inc(fatalCodes, f); rowHasFatal = true; }
  }
  if (rowHasFatal) withFatal++;
}

const pct = (n: number, d = rows) => d ? `${((n / d) * 100).toFixed(2)}%` : "—";
const bar = (n: number, d: number, w = 28) => {
  const filled = Math.max(0, Math.min(w, Math.round((n / Math.max(d, 1)) * w)));
  return "#".repeat(filled) + "·".repeat(w - filled);
};

console.log(`\n  GEBO — registry census analysis`);
console.log(`  ${"=".repeat(74)}`);
console.log(`  rows analysed            ${rows.toLocaleString()}`);
console.log(`  highest tokenId          ${maxToken.toLocaleString()}`);
console.log(`  distinct owners          ${owners.size.toLocaleString()}`);
console.log(`  agents per owner (mean)  ${(rows / Math.max(owners.size, 1)).toFixed(1)}`);

console.log(`\n  METADATA POINTER (tokenURI scheme)`);
for (const [k, n] of [...uriScheme].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(9)} ${String(n).padStart(8)}  ${pct(n).padStart(7)}  ${bar(n, rows)}`);
}

console.log(`\n  REGISTRATION FILE RESOLUTION`);
console.log(`    resolved            ${String(resolved).padStart(8)}  ${pct(resolved)}`);
console.log(`    deferred (remote)   ${String(resolveDeferred).padStart(8)}  ${pct(resolveDeferred)}   <- data: URIs only in this pass`);
console.log(`    failed              ${String(resolveFailed).padStart(8)}  ${pct(resolveFailed)}`);
if (resolveErrors.size) {
  console.log(`    top failure reasons:`);
  for (const [e, n] of [...resolveErrors].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`      ${String(n).padStart(7)}  ${e}`);
  }
}

console.log(`\n  OF THE ${resolved.toLocaleString()} RESOLVED REGISTRATIONS`);
console.log(`    has a name              ${String(namedAgents).padStart(7)}  ${pct(namedAgents, resolved)}`);
console.log(`    declares any endpoint   ${String(withEndpoints).padStart(7)}  ${pct(withEndpoints, resolved)}`);
console.log(`    callable + lint-clean   ${String(callable).padStart(7)}  ${pct(callable, resolved)}`);
console.log(`    has a fatal URL defect  ${String(withFatal).padStart(7)}  ${pct(withFatal, resolved)}`);
console.log(`    self-declares active    ${String(declaredActive).padStart(7)}  ${pct(declaredActive, resolved)}`);
console.log(`    supports x402           ${String(x402).padStart(7)}  ${pct(x402, resolved)}`);

if (endpointKinds.size) {
  console.log(`\n  ENDPOINT KINDS DECLARED`);
  for (const [k, n] of [...endpointKinds].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(6)} ${String(n).padStart(8)}`);
  }
}

if (trustModels.size) {
  console.log(`\n  supportedTrust DECLARED`);
  for (const [k, n] of [...trustModels].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${k.padEnd(22)} ${String(n).padStart(7)}`);
  }
} else {
  console.log(`\n  supportedTrust DECLARED    none, by any agent`);
}

if (fatalCodes.size) {
  console.log(`\n  FATAL REGISTRATION DEFECTS`);
  for (const [k, n] of [...fatalCodes].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(20)} ${String(n).padStart(7)}`);
  }
}

console.log(`\n  OPERATOR CONCENTRATION (by endpoint domain)`);
const ops = [...operators].sort((a, b) => b[1] - a[1]);
console.log(`    distinct operators   ${ops.length.toLocaleString()}`);
const totalEp = ops.reduce((s, [, n]) => s + n, 0);
const topN = (k: number) => ops.slice(0, k).reduce((s, [, n]) => s + n, 0);
if (ops.length) {
  console.log(`    top 1 holds          ${pct(topN(1), totalEp)} of all declared endpoints`);
  console.log(`    top 5 hold           ${pct(topN(5), totalEp)}`);
  console.log(`    top 20 hold          ${pct(topN(20), totalEp)}`);
  console.log(`\n    ${"operator".padEnd(38)} ${"endpoints".padStart(9)} ${"callable".padStart(9)}`);
  for (const [dom, n] of ops.slice(0, 15)) {
    const c = operatorCallable.get(dom) ?? 0;
    console.log(`    ${dom.slice(0, 37).padEnd(38)} ${String(n).padStart(9)} ${String(c).padStart(9)}`);
  }
}

console.log(`\n  OWNER CONCENTRATION`);
const own = [...owners].sort((a, b) => b[1] - a[1]);
if (own.length) {
  console.log(`    top owner holds      ${own[0]![1].toLocaleString()} agents  (${pct(own[0]![1])})`);
  console.log(`    top 10 owners hold   ${pct(own.slice(0, 10).reduce((s, [, n]) => s + n, 0))}`);
  console.log(`    owners with 1 agent  ${own.filter(([, n]) => n === 1).length.toLocaleString()}`);
  console.log(`\n    ${"owner".padEnd(44)} ${"agents".padStart(8)}`);
  for (const [o, n] of own.slice(0, 8)) console.log(`    ${o.padEnd(44)} ${String(n).padStart(8)}`);
}

// ── persist ────────────────────────────────────────────────────────────────
// The app reads these figures at request time. Writing them here is what stops
// the funnel, the headline, and the page metadata from drifting out of sync.
{
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(`\n  DATABASE_URL not set — figures not persisted, app will use its fallback\n`);
  } else {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
    try {
      const share = (n: number, d: number) => (d ? Number(((n / d) * 100).toFixed(2)) : 0);
      const totalEndpoints = ops.reduce((s, [, n]) => s + n, 0);
      const topOps = ops.slice(0, 15).map(([domain, endpoints]) => ({
        domain, endpoints, callable: operatorCallable.get(domain) ?? 0,
      }));

      await sql`
        insert into census_stats ${sql({
          id: "bsc",
          chain_id: 56,
          registry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
          tokens_minted: maxToken,
          censused: rows,
          resolved,
          named: namedAgents,
          claim_active: declaredActive,
          with_endpoint: withEndpoints,
          callable,
          operators: ops.length,
          owners: owners.size,
          owners_with_one_agent: own.filter(([, n]) => n === 1).length,
          largest_operator_share: ops.length ? share(ops[0]![1], totalEndpoints) : 0,
          top5_operator_share: share(ops.slice(0, 5).reduce((s, [, n]) => s + n, 0), totalEndpoints),
          top20_operator_share: share(ops.slice(0, 20).reduce((s, [, n]) => s + n, 0), totalEndpoints),
          top10_owner_share: share(own.slice(0, 10).reduce((s, [, n]) => s + n, 0), rows),
          declares_reputation: trustModels.get("reputation") ?? 0,
          empty_token_uri: uriScheme.get("empty") ?? 0,
          x402_supported: x402,
          fatal_defects: withFatal,
          uri_schemes: sql.json(Object.fromEntries(uriScheme)),
          endpoint_kinds: sql.json(Object.fromEntries(endpointKinds)),
          trust_models: sql.json(Object.fromEntries([...trustModels].slice(0, 12))),
          top_operators: sql.json(topOps),
          measured_at: new Date(),
          updated_at: new Date(),
        } as any)}
        on conflict (id) do update set
          tokens_minted = excluded.tokens_minted,
          censused = excluded.censused,
          resolved = excluded.resolved,
          named = excluded.named,
          claim_active = excluded.claim_active,
          with_endpoint = excluded.with_endpoint,
          callable = excluded.callable,
          operators = excluded.operators,
          owners = excluded.owners,
          owners_with_one_agent = excluded.owners_with_one_agent,
          largest_operator_share = excluded.largest_operator_share,
          top5_operator_share = excluded.top5_operator_share,
          top20_operator_share = excluded.top20_operator_share,
          top10_owner_share = excluded.top10_owner_share,
          declares_reputation = excluded.declares_reputation,
          empty_token_uri = excluded.empty_token_uri,
          x402_supported = excluded.x402_supported,
          fatal_defects = excluded.fatal_defects,
          uri_schemes = excluded.uri_schemes,
          endpoint_kinds = excluded.endpoint_kinds,
          trust_models = excluded.trust_models,
          top_operators = excluded.top_operators,
          measured_at = excluded.measured_at,
          updated_at = now()
      `;
      console.log(`\n  PERSISTED to census_stats — the app now reads these figures live`);
    } catch (e: any) {
      console.error(`\n  persist failed: ${String(e?.message ?? e).slice(0, 240)}`);
      process.exitCode = 1;
    } finally {
      await sql.end({ timeout: 6 });
    }
  }
}
console.log("");
