/**
 * Probe every agent endpoint worth probing, and record the result.
 *
 * Scale problem this solves: 21,278 agents are indexed but only ~100 had ever
 * been probed, so the product reported "not yet probed" for 99.5% of its own
 * catalogue — the weakest part of a data-quality claim.
 *
 * PER-OPERATOR CAP. Endpoint concentration is extreme: one operator
 * (evoevo.ai) holds 19,329 agents, and probing all of them would spend hours
 * hammering a single host to establish one fact. So every operator is probed up
 * to PER_OPERATOR_CAP agents. Operators below the cap are probed exhaustively,
 * which is most of them. The cap is disclosed in the UI rather than hidden —
 * an undisclosed sample presented as a census would be exactly the kind of
 * dishonesty this project exists to call out.
 *
 * Writes:
 *   probes_raw    one row per probe (48h debugging window)
 *   probe_daily   per-endpoint per-day counters — what uptime is computed from
 *   probe_events  state transitions only (up->down, down->up)
 *   agents        trust_state / trust_reason, unless already SHADOWED by lint
 */
import "dotenv/config";
import postgres from "postgres";
import { probeEndpoint, type Endpoint, type ProbeOutcome } from "../src/lib/probe.ts";

const PER_OPERATOR_CAP = Number(process.env.PER_OPERATOR_CAP ?? 60);
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 20);
const HOST_GAP_MS = Number(process.env.HOST_GAP_MS ?? 300);
const LIMIT = Number(process.argv.includes("--limit") ? process.argv[process.argv.indexOf("--limit") + 1] : 0);
/**
 * --due restricts the sweep to endpoints whose next_probe_at has come due, which
 * is what a scheduled run wants. Without it every run re-probes the same capped
 * slice, which produces no new observations and wastes third-party requests.
 */
const DUE_ONLY = process.argv.includes("--due");

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }

const sql = postgres(url, { prepare: false, max: 6, connect_timeout: 25, onnotice: () => {} });

type Target = {
  endpoint_id: number;
  token_id: string;
  kind: string;
  url: string;
  host: string | null;
  operator_key: string | null;
  trust_state: string | null;
};

console.log("");

// Rank within operator so the cap takes a deterministic slice rather than
// whatever the planner happens to return.
const targets = await sql<Target[]>`
  with ranked as (
    select
      e.id            as endpoint_id,
      a.token_id::text as token_id,
      e.kind, e.url, e.host,
      a.operator_key, a.trust_state,
      row_number() over (
        partition by coalesce(a.operator_key, 'none')
        order by a.token_id desc
      ) as rn
    from agent_endpoints e
    join agents a on a.chain_id = e.chain_id and a.token_id = e.token_id
    where e.chain_id = 56
      and e.url <> ''
      and e.probe_tier < 3          -- tier 3 = fatal lint defect, not worth a request
      and e.kind in ('a2a', 'mcp')  -- web endpoints assert no agent protocol
      ${DUE_ONLY ? sql`and (e.next_probe_at is null or e.next_probe_at <= now())` : sql``}
  )
  select endpoint_id, token_id, kind, url, host, operator_key, trust_state
  from ranked
  where rn <= ${PER_OPERATOR_CAP}
  order by operator_key nulls last, endpoint_id
  ${LIMIT ? sql`limit ${LIMIT}` : sql``}
`;

console.log(`  mode               ${DUE_ONLY ? "due only (scheduled run)" : "full sweep"}`);
console.log(`  targets            ${targets.length.toLocaleString()}  (cap ${PER_OPERATOR_CAP}/operator, A2A+MCP only)`);

if (!targets.length) {
  console.log(`\n  nothing due — exiting cleanly\n`);
  await sql.end({ timeout: 5 });
  process.exit(0);
}

const byOperator = new Map<string, number>();
for (const t of targets) byOperator.set(t.operator_key ?? "none", (byOperator.get(t.operator_key ?? "none") ?? 0) + 1);
console.log(`  operators covered  ${byOperator.size}`);
const capped = [...byOperator.entries()].filter(([, n]) => n >= PER_OPERATOR_CAP);
if (capped.length) {
  console.log(`  hit the cap        ${capped.map(([k]) => k.replace("host:", "")).join(", ")}`);
}

// ── per-host pacing ────────────────────────────────────────────────────────
const hostNext = new Map<string, number>();
async function politeWait(host: string | null) {
  if (!host) return;
  const now = Date.now();
  const next = Math.max(hostNext.get(host) ?? 0, now);
  hostNext.set(host, next + HOST_GAP_MS);
  const wait = next - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const tally = { validated: 0, responded: 0, failed: 0 };
const errClasses = new Map<string, number>();
const t0 = Date.now();
let done = 0;
let cursor = 0;

type Result = { target: Target; outcome: ProbeOutcome };
const buffer: Result[] = [];

async function flush() {
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  const today = new Date().toISOString().slice(0, 10);

  await sql`
    insert into probes_raw ${sql(batch.map((b) => ({
      endpoint_id: b.target.endpoint_id,
      grade: b.outcome.grade,
      http_status: b.outcome.httpStatus,
      rtt_ms: b.outcome.rttMs,
      err_class: b.outcome.errClass,
      evidence: b.outcome.evidence ? sql.json(b.outcome.evidence as any) : null,
    })) as any)}
  `;

  // One rollup row per endpoint per day, accumulated rather than overwritten.
  await sql`
    insert into probe_daily ${sql(batch.map((b) => ({
      endpoint_id: b.target.endpoint_id,
      day: today,
      probes: 1,
      ok_count: b.outcome.grade === "failed" ? 0 : 1,
      validated_count: b.outcome.grade === "validated" ? 1 : 0,
      p50_ms: b.outcome.rttMs,
      p95_ms: b.outcome.rttMs,
      fail_streak: b.outcome.grade === "failed" ? 1 : 0,
      last_ok_at: b.outcome.grade === "failed" ? null : new Date(),
      err_counts: sql.json({ [b.outcome.errClass]: 1 }),
    })) as any)}
    on conflict (endpoint_id, day) do update set
      probes          = probe_daily.probes + 1,
      ok_count        = probe_daily.ok_count + excluded.ok_count,
      validated_count = probe_daily.validated_count + excluded.validated_count,
      p50_ms          = (probe_daily.p50_ms + excluded.p50_ms) / 2,
      p95_ms          = greatest(probe_daily.p95_ms, excluded.p95_ms),
      fail_streak     = case when excluded.fail_streak = 0 then 0
                             else probe_daily.fail_streak + 1 end,
      last_ok_at      = coalesce(excluded.last_ok_at, probe_daily.last_ok_at)
  `;

  // Trust state, but never overwrite a SHADOWED verdict — a fatal registration
  // defect is a stronger and more durable fact than a single probe outcome.
  for (const b of batch) {
    const grade = b.outcome.grade;
    const state = grade === "validated" ? "VERIFIED" : grade === "responded" ? "LISTED" : "DORMANT";
    const reason =
      grade === "validated"
        ? `completed a ${b.target.kind.toUpperCase()} handshake in ${b.outcome.rttMs} ms`
        : grade === "responded"
          ? b.outcome.errDetail ?? "responded but did not speak the protocol"
          : b.outcome.errDetail ?? `no usable response (${b.outcome.errClass})`;

    await sql`
      update agents
      set trust_state = ${state}, trust_reason = ${reason.slice(0, 300)}, updated_at = now()
      where chain_id = 56 and token_id = ${b.target.token_id}
        and trust_state <> 'SHADOWED'
    `;
  }

  // Transitions only. A row per probe would swamp the table; a change is news.
  const transitions = batch.filter((b) => {
    const now = b.outcome.grade === "validated" ? "VERIFIED" : b.outcome.grade === "responded" ? "LISTED" : "DORMANT";
    return b.target.trust_state && b.target.trust_state !== "SHADOWED" && b.target.trust_state !== now;
  });
  if (transitions.length) {
    await sql`
      insert into probe_events ${sql(transitions.map((b) => ({
        endpoint_id: b.target.endpoint_id,
        from_grade: b.target.trust_state,
        to_grade: b.outcome.grade === "validated" ? "VERIFIED" : b.outcome.grade === "responded" ? "LISTED" : "DORMANT",
        http_status: b.outcome.httpStatus,
        err_class: b.outcome.errClass,
        detail: (b.outcome.errDetail ?? "").slice(0, 200) || null,
      })) as any)}
    `;
  }

  // Reschedule: responsive endpoints get probed often, dead ones rarely.
  for (const b of batch) {
    const tier = b.outcome.grade === "validated" ? 0 : b.outcome.grade === "responded" ? 1 : 2;
    const nextIn = tier === 0 ? "15 minutes" : tier === 1 ? "6 hours" : "3 days";
    await sql`
      update agent_endpoints
      set probe_tier = ${tier}, next_probe_at = now() + ${nextIn}::interval
      where id = ${b.target.endpoint_id}
    `;
  }
}

async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= targets.length) return;
    const t = targets[i]!;

    await politeWait(t.host);
    const outcome = await probeEndpoint({ kind: t.kind as Endpoint["kind"], url: t.url });

    tally[outcome.grade]++;
    errClasses.set(outcome.errClass, (errClasses.get(outcome.errClass) ?? 0) + 1);
    buffer.push({ target: t, outcome });
    done++;

    if (buffer.length >= 40) await flush();

    if (done % 200 === 0) {
      const mins = (Date.now() - t0) / 60_000;
      const rate = done / Math.max(mins, 0.01);
      console.log(
        `    ${done.toLocaleString()}/${targets.length.toLocaleString()}  ${rate.toFixed(0)}/min  ` +
        `validated=${tally.validated} responded=${tally.responded} failed=${tally.failed}`,
      );
    }
  }
}

console.log("");
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await flush();

const mins = (Date.now() - t0) / 60_000;
console.log(`\n  PROBING DONE — ${done.toLocaleString()} endpoints in ${mins.toFixed(1)} min`);
console.log(`  validated  ${tally.validated.toLocaleString()}  (spoke A2A or MCP correctly)`);
console.log(`  responded  ${tally.responded.toLocaleString()}  (2xx, wrong shape)`);
console.log(`  failed     ${tally.failed.toLocaleString()}`);
console.log(`  error classes: ${JSON.stringify(Object.fromEntries([...errClasses].sort((a, b) => b[1] - a[1])))}`);

const states = await sql<{ trust_state: string; n: number }[]>`
  select trust_state, count(*)::int as n from agents where chain_id = 56 group by trust_state order by n desc`;
console.log(`\n  agent trust states now: ${states.map((s) => `${s.trust_state}=${s.n.toLocaleString()}`).join("  ")}`);

const verifiedOps = await sql<{ label: string; n: number }[]>`
  select o.label, count(*)::int as n
  from agents a join operators o on o.key = a.operator_key
  where a.chain_id = 56 and a.trust_state = 'VERIFIED'
  group by o.label order by n desc limit 10`;
if (verifiedOps.length) {
  console.log(`\n  operators with verified agents:`);
  for (const o of verifiedOps) console.log(`    ${o.label.padEnd(38)} ${o.n}`);
}

await sql.end({ timeout: 10 });
console.log("");
