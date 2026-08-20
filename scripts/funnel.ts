/**
 * Longitudinal probe + trust funnel.
 *
 * Answers the question the marketplace exists to answer: of the agents
 * registered on BSC, how many are actually reachable right now?
 *
 * Sampling is deliberately stratified into two cohorts, because the population
 * is bimodal (mass-minted farm registrations vs. real deployments). Reporting a
 * single blended number would hide that, and would invite a fair accusation of
 * sampling bias.
 *
 *   Cohort NEWEST — most recently registered, callable agents
 *   Cohort BEST   — highest total_score, callable agents
 *
 * "Callable" = declares MCP or A2A. Web/Email-only agents cannot be hired by
 * software and are excluded from the probe (but still counted in the funnel).
 *
 * Errors are classified, because "DNS does not resolve" (abandoned) is a
 * different fact from "connection timed out" (possibly alive but unreachable
 * from our vantage point). Conflating them would overstate death.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { countAgents, iterateAgents, getAgentDetail, getStats, stats, type AgentDetail } from "../src/lib/scan.ts";

const CHAIN = 56;
const PER_COHORT = Number(process.env.SAMPLE ?? 120);
const PROBE_CONCURRENCY = 16;
const PROBE_TIMEOUT_MS = 8000;

type ErrClass =
  | "ok"
  | "http_4xx"
  | "http_5xx"
  | "dns"
  | "timeout"
  | "tls"
  | "refused"
  | "no_endpoint"
  | "bad_url"
  | "other";

type ProbeResult = {
  agent_id: string;
  token_id: string;
  name: string | null;
  cohort: "NEWEST" | "BEST";
  protocols: string[];
  endpointKind: "mcp" | "a2a" | "agent_url" | "none";
  url: string | null;
  ok: boolean;
  httpStatus: number | null;
  rttMs: number | null;
  errClass: ErrClass;
  errDetail: string | null;
  // what 8004scan asserts, for comparison against what we measure
  scan_health_score: number | null;
  scan_health_status: string | null;
  scan_health_checked_at: string | null;
  scan_is_active: boolean | null;
  scan_endpoint_verified: boolean | null;
  total_score: number;
  total_feedbacks: number;
  created_at: string;
};

function classify(e: any): { cls: ErrClass; detail: string } {
  const msg = String(e?.cause?.code ?? e?.code ?? e?.name ?? e?.message ?? e);
  const m = msg.toLowerCase();
  if (m.includes("enotfound") || m.includes("eai_again") || m.includes("getaddrinfo")) return { cls: "dns", detail: msg };
  if (m.includes("timeout") || m.includes("aborted") || m.includes("headerstimeout")) return { cls: "timeout", detail: msg };
  if (m.includes("econnrefused")) return { cls: "refused", detail: msg };
  if (m.includes("cert") || m.includes("tls") || m.includes("ssl") || m.includes("altname")) return { cls: "tls", detail: msg };
  if (m.includes("invalid url") || m.includes("failed to parse")) return { cls: "bad_url", detail: msg };
  return { cls: "other", detail: msg.slice(0, 160) };
}

function pickEndpoint(d: AgentDetail): { kind: ProbeResult["endpointKind"]; url: string | null } {
  if (d.a2a_endpoint) return { kind: "a2a", url: d.a2a_endpoint };
  if (d.mcp_server) return { kind: "mcp", url: d.mcp_server };
  if (d.agent_url) return { kind: "agent_url", url: d.agent_url };
  return { kind: "none", url: null };
}

async function probe(url: string): Promise<Pick<ProbeResult, "ok" | "httpStatus" | "rttMs" | "errClass" | "errDetail">> {
  let u: URL;
  try {
    u = new URL(url);
  } catch (e) {
    return { ok: false, httpStatus: null, rttMs: null, errClass: "bad_url", errDetail: String(url).slice(0, 120) };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, httpStatus: null, rttMs: null, errClass: "bad_url", errDetail: u.protocol };
  }

  const t0 = performance.now();
  try {
    const res = await fetch(u, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "application/json, text/plain, */*", "user-agent": "gebo-prober/0.1" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const rtt = Math.round(performance.now() - t0);
    const cls: ErrClass = res.ok ? "ok" : res.status >= 500 ? "http_5xx" : "http_4xx";
    return { ok: res.ok, httpStatus: res.status, rttMs: rtt, errClass: cls, errDetail: res.ok ? null : res.statusText };
  } catch (e) {
    const { cls, detail } = classify(e);
    return { ok: false, httpStatus: null, rttMs: Math.round(performance.now() - t0), errClass: cls, errDetail: detail };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

async function collectCohort(
  cohort: "NEWEST" | "BEST",
  sortBy: "created_at" | "total_score",
): Promise<AgentListItemLite[]> {
  const picked: AgentListItemLite[] = [];
  for (const protocol of ["A2A", "MCP"] as const) {
    const need = Math.ceil(PER_COHORT / 2);
    for await (const page of iterateAgents(
      { chainId: CHAIN, protocol, sortBy, sortOrder: "desc", isTestnet: false },
      { pageSize: 100 },
    )) {
      for (const a of page) {
        picked.push({ token_id: a.token_id, agent_id: a.agent_id, name: a.name, protocols: a.supported_protocols ?? [] });
        if (picked.length >= (protocol === "A2A" ? need : PER_COHORT)) break;
      }
      if (picked.length >= (protocol === "A2A" ? need : PER_COHORT)) break;
    }
    if (picked.length >= PER_COHORT) break;
  }
  return picked.slice(0, PER_COHORT);
}

type AgentListItemLite = { token_id: string; agent_id: string; name: string | null; protocols: string[] };

// ── run ────────────────────────────────────────────────────────────────────
console.log("\n  GEBO — trust funnel");
console.log("  " + "=".repeat(72));

const s = await getStats();
const bscStats = (s.chain_stats as any[]).find((c) => c.chain_id === CHAIN);

const totalBsc = await countAgents({ chainId: CHAIN, isTestnet: false });
const mcpCount = await countAgents({ chainId: CHAIN, protocol: "MCP", isTestnet: false });
const a2aCount = await countAgents({ chainId: CHAIN, protocol: "A2A", isTestnet: false });

console.log(`\n  POPULATION (8004scan, live)`);
console.log(`    registered on BSC              ${totalBsc.toLocaleString()}`);
console.log(`    declares MCP                   ${mcpCount.toLocaleString()}`);
console.log(`    declares A2A                   ${a2aCount.toLocaleString()}`);
console.log(`    callable upper bound (MCP+A2A) ${(mcpCount + a2aCount).toLocaleString()}  (${(((mcpCount + a2aCount) / totalBsc) * 100).toFixed(1)}% — overlap not deduped)`);
console.log(`    total feedbacks ever           ${Number(bscStats?.total_feedbacks ?? 0).toLocaleString()}`);
console.log(`    feedbacks today                ${Number(bscStats?.daily_feedbacks ?? 0).toLocaleString()}`);
console.log(`    new agents today               ${Number(bscStats?.daily_new_agents ?? 0).toLocaleString()}`);

const results: ProbeResult[] = [];

for (const [cohort, sortBy] of [["NEWEST", "created_at"], ["BEST", "total_score"]] as const) {
  console.log(`\n  COHORT ${cohort} — sampling ${PER_COHORT} callable agents...`);
  const sample = await collectCohort(cohort, sortBy);
  console.log(`    sampled ${sample.length}, hydrating detail...`);

  const details = await mapLimit(sample, 6, async (a) => {
    try {
      return await getAgentDetail(CHAIN, a.token_id);
    } catch {
      return null;
    }
  });

  const targets = details
    .map((d, i) => ({ d, lite: sample[i]! }))
    .filter((x): x is { d: AgentDetail; lite: AgentListItemLite } => x.d !== null);

  console.log(`    hydrated ${targets.length}, probing endpoints...`);

  const probed = await mapLimit(targets, PROBE_CONCURRENCY, async ({ d, lite }) => {
    const { kind, url } = pickEndpoint(d);
    const base: ProbeResult = {
      agent_id: d.agent_id ?? lite.agent_id,
      token_id: String(d.token_id ?? lite.token_id),
      name: d.name ?? lite.name,
      cohort,
      protocols: d.supported_protocols ?? lite.protocols,
      endpointKind: kind,
      url,
      ok: false,
      httpStatus: null,
      rttMs: null,
      errClass: "no_endpoint",
      errDetail: null,
      scan_health_score: d.health_score ?? null,
      scan_health_status: d.health_status ?? null,
      scan_health_checked_at: d.health_checked_at ?? null,
      scan_is_active: d.is_active ?? null,
      scan_endpoint_verified: d.is_endpoint_verified ?? null,
      total_score: d.total_score ?? 0,
      total_feedbacks: d.total_feedbacks ?? 0,
      created_at: d.created_at,
    };
    if (!url) return base;
    const p = await probe(url);
    return { ...base, ...p };
  });

  results.push(...probed);

  const n = probed.length;
  const withEp = probed.filter((r) => r.url).length;
  const ok = probed.filter((r) => r.ok).length;
  const byErr = probed.reduce<Record<string, number>>((acc, r) => {
    acc[r.errClass] = (acc[r.errClass] ?? 0) + 1;
    return acc;
  }, {});
  const lat = probed.filter((r) => r.ok && r.rttMs !== null).map((r) => r.rttMs!).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))]! : null);

  console.log(`\n    ${cohort} RESULT   n=${n}`);
  console.log(`      has a probeable endpoint     ${withEp}  (${((withEp / n) * 100).toFixed(1)}%)`);
  console.log(`      responded 2xx                ${ok}  (${((ok / n) * 100).toFixed(1)}% of sample, ${withEp ? ((ok / withEp) * 100).toFixed(1) : "0"}% of those with an endpoint)`);
  console.log(`      latency p50 / p95            ${pct(lat, 50) ?? "-"} ms / ${pct(lat, 95) ?? "-"} ms`);
  console.log(`      error classes                ${JSON.stringify(byErr)}`);

  // Compare our measurement against 8004scan's own assertion.
  const claimedHealthy = probed.filter((r) => r.scan_health_score !== null && r.scan_health_score >= 100);
  const claimedHealthyButDead = claimedHealthy.filter((r) => !r.ok);
  console.log(`      8004scan health_score=100    ${claimedHealthy.length}`);
  console.log(`        ...of which WE got no 2xx  ${claimedHealthyButDead.length}  <-- snapshot vs longitudinal gap`);
}

mkdirSync("data", { recursive: true });
const outPath = `data/probe-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`;
writeFileSync(outPath, results.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

const allOk = results.filter((r) => r.ok).length;
console.log("\n  " + "=".repeat(72));
console.log(`  TOTAL PROBED ${results.length}   RESPONDED ${allOk} (${((allOk / results.length) * 100).toFixed(1)}%)`);
console.log(`  api requests=${stats.requests} retries=${stats.retries} rateLimitWaits=${stats.rateLimitWaits}`);
console.log(`  written: ${outPath}\n`);
