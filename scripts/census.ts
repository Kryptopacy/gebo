/**
 * Full census of callable ERC-8004 agents on BSC.
 *
 * Replaces the sampled estimate in docs/MEASUREMENTS.md with the real number.
 * Enumerates every agent declaring MCP or A2A, hydrates detail (the only place
 * endpoint URLs live), lints the registration, and probes the endpoint.
 *
 * Resumable: appends NDJSON and skips agents already recorded, so it can be
 * killed and restarted without losing progress or re-spending API quota.
 */
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { iterateAgents, getAgentDetail, countAgents, stats, type AgentDetail } from "../src/lib/scan.ts";
import { lintRegistration } from "../src/lib/lint.ts";
import { probeEndpoint, pickEndpoints } from "../src/lib/probe.ts";
import { operatorOf } from "../src/lib/operator.ts";

const CHAIN = 56;
const OUT = "data/census-bsc.ndjson";
const HYDRATE_CONCURRENCY = 6;
const PROBE_CONCURRENCY = 24;
const BATCH = 60;

mkdirSync("data", { recursive: true });

// ── resume ────────────────────────────────────────────────────────────────
const seen = new Set<string>();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { seen.add(JSON.parse(line).token_id); } catch { /* skip partial line */ }
  }
  console.log(`  resuming — ${seen.size} agents already recorded`);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
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

const mcp = await countAgents({ chainId: CHAIN, protocol: "MCP", isTestnet: false });
const a2a = await countAgents({ chainId: CHAIN, protocol: "A2A", isTestnet: false });
const total = await countAgents({ chainId: CHAIN, isTestnet: false });
console.log(`\n  BSC census — registered=${total.toLocaleString()} mcp=${mcp.toLocaleString()} a2a=${a2a.toLocaleString()}`);
console.log(`  target: every agent declaring MCP or A2A (upper bound ${(mcp + a2a).toLocaleString()}, overlap deduped by token_id)\n`);

let queued: { token_id: string }[] = [];
let done = 0;
const t0 = Date.now();

async function flush() {
  if (!queued.length) return;
  const batch = queued;
  queued = [];

  const details = await mapLimit(batch, HYDRATE_CONCURRENCY, async (a) => {
    try { return await getAgentDetail(CHAIN, a.token_id); } catch { return null; }
  });

  const rows = await mapLimit(
    details.filter((d): d is AgentDetail => d !== null),
    PROBE_CONCURRENCY,
    async (d) => {
      const eps = pickEndpoints(d);
      const lint = lintRegistration(d, eps);
      const primary = eps[0] ?? null;
      const p = primary ? await probeEndpoint(primary) : null;
      return {
        token_id: String(d.token_id),
        agent_id: d.agent_id,
        name: d.name,
        owner_address: d.owner_address,
        protocols: d.supported_protocols ?? [],
        x402: d.x402_supported ?? false,
        created_at: d.created_at,
        operator: operatorOf(d, eps),
        endpoints: eps,
        lint,
        probe: p,
        scan: {
          health_score: d.health_score ?? null,
          health_status: d.health_status ?? null,
          is_active: d.is_active ?? null,
          endpoint_verified: d.is_endpoint_verified ?? null,
          total_score: d.total_score ?? 0,
          total_feedbacks: d.total_feedbacks ?? 0,
          quality: d.quality_score ?? null,
          freshness: d.freshness_score ?? null,
        },
        probed_at: new Date().toISOString(),
      };
    },
  );

  appendFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  done += rows.length;

  const rate = done / ((Date.now() - t0) / 60_000);
  console.log(`    +${rows.length}  total=${done}  ${rate.toFixed(0)}/min  api=${stats.requests} retries=${stats.retries} waits=${stats.rateLimitWaits}`);
}

for (const protocol of ["A2A", "MCP"] as const) {
  console.log(`  --- enumerating ${protocol} ---`);
  for await (const page of iterateAgents(
    { chainId: CHAIN, protocol, isTestnet: false, sortBy: "created_at", sortOrder: "desc" },
    { pageSize: 100 },
  )) {
    for (const a of page) {
      if (seen.has(a.token_id)) continue;
      seen.add(a.token_id);
      queued.push({ token_id: a.token_id });
    }
    if (queued.length >= BATCH) await flush();
  }
  await flush();
}
await flush();

console.log(`\n  CENSUS COMPLETE — ${done} agents written to ${OUT}`);
console.log(`  elapsed ${((Date.now() - t0) / 60_000).toFixed(1)} min, api requests ${stats.requests}\n`);
