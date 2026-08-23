/**
 * Liveness ledger reads.
 *
 * This is the data GEBO produces rather than resells. Third-party indexers record
 * registration and a point-in-time health flag; none of them keep a longitudinal
 * record, so none can answer "has this agent been reliable" or "when did it stop
 * answering". probe_daily and probe_events can.
 *
 * Storage is rollup-first by necessity. One row per probe would be roughly 1.75M
 * rows and ~306 MB a day across the callable set, exhausting a 500 MB tier in
 * under two days. So probe_daily holds per-endpoint per-day counters and
 * probe_events holds only state transitions - a change is news, an unchanged
 * state is not.
 */
import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = postgres(url, {
      prepare: false, max: 3, idle_timeout: 20, connect_timeout: 8, onnotice: () => {},
    });
  }
  return client;
}

async function guard<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((r) => { t = setTimeout(() => r(fallback), ms); })]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export type LivenessSummary = {
  endpointsTracked: number;
  probesRecorded: number;
  probesToday: number;
  answeringToday: number;
  validatedToday: number;
  daysOfHistory: number;
  transitions: number;
  transitionsToday: number;
  p50Ms: number | null;
  p95Ms: number | null;
  errorClasses: { cls: string; n: number }[];
  /**
   * Did the measurement fail, as distinct from measuring zero?
   *
   * This exists because the page rendered a confident "0" for every figure when
   * the query threw, timed out, or found no DATABASE_URL. A single malformed
   * err_counts row was enough to do it: one rejected promise in a Promise.all
   * returned the all-zero fallback, and the ledger claimed 0 probes across 0
   * endpoints while the database held 43,321.
   *
   * On a product whose entire argument is that its numbers are measured rather
   * than asserted, a fabricated zero is the worst failure available. The caller
   * must render this state as unavailable, never as a value.
   */
  unavailable: boolean;
  /** What failed, for the reader and for the operator. Null when fine. */
  unavailableReason: string | null;
};

export type Transition = {
  at: string;
  tokenId: string | null;
  name: string | null;
  operator: string | null;
  from: string | null;
  to: string;
  errClass: string | null;
  detail: string | null;
  url: string | null;
  /** A sentence a person can read. See humanReason. */
  reason: string;
};

/**
 * Plain-English explanations for each classified outcome.
 *
 * Kept distinct because "DNS does not resolve" describes an abandoned agent while
 * "timed out" may describe a live one we cannot reach, and collapsing them would
 * overstate how much of the chain is dead.
 */
const OUTCOME_REASON: Record<string, string> = {
  ok: "Answered correctly",
  dns: "Its domain no longer resolves",
  timeout: "Did not respond in time",
  tls: "TLS or certificate failure",
  refused: "Refused the connection",
  reset: "Dropped the connection mid-request",
  http_4xx: "Returned a client error, so a server exists but the endpoint does not",
  http_5xx: "Returned a server error",
  non_json: "Answered, but not with parseable JSON",
  bad_url: "Its registered address is not a usable URL",
  no_endpoint: "Declares no endpoint to reach",
  other: "Failed for an unclassified reason",
};

/**
 * Is this detail string worth showing a person?
 *
 * Probe detail is raw transport output. It has included bare error codes ("23")
 * and whole Cloudflare error-page bodies, neither of which means anything to a
 * reader. Only prose-shaped fragments survive.
 */
function usefulDetail(detail: string | null): string | null {
  if (!detail) return null;
  const d = detail.trim();
  if (d.length < 8) return null;                    // bare codes like "23"
  if (/^[\d\s.,:-]+$/.test(d)) return null;          // numbers only
  if (/^[[{"]/.test(d)) return null;                 // JSON or a quoted payload
  if (d.includes("cloudflare.com/support")) return null; // vendor error page
  if (!/[a-z]{3}/i.test(d)) return null;             // no real words
  return d.replace(/\s+/g, " ").slice(0, 110);
}

/**
 * Turn a transition into one readable sentence.
 *
 * The stored detail is a fallback, not the headline: an agent's state change
 * should be legible without knowing what an HTTP status or an errno means.
 */
export function humanReason(
  to: string,
  errClass: string | null,
  detail: string | null,
): string {
  const base = errClass ? OUTCOME_REASON[errClass] : null;

  if (to === "VERIFIED") return "Answered and spoke the protocol correctly";
  if (to === "SHADOWED") return "Its registration is broken, so no client can call it";

  if (to === "LISTED") {
    /**
     * A server replied but did not behave like an agent. The stored detail here
     * is developer shorthand - "2xx but no MCP initialize result" - so it is
     * translated rather than surfaced. The distinction a reader needs is that
     * something is hosted at the address, but it is not an agent.
     */
    const d = (detail ?? "").toLowerCase();
    if (d.includes("initialize")) return "Its address responds, but not as an MCP agent";
    if (d.includes("agent card")) return "Its address responds, but not with a valid agent card";
    if (d.includes("json")) return "Its address responds, but not with usable JSON";
    return "A server answered, but not as an agent";
  }

  // DORMANT and anything else.
  const d = usefulDetail(detail);
  if (base && d && !d.toLowerCase().startsWith(base.slice(0, 10).toLowerCase())) {
    return `${base} — ${d}`;
  }
  return base ?? d ?? "Stopped answering";
}

export type UptimeRow = {
  tokenId: string;
  name: string | null;
  operator: string | null;
  kind: string;
  probes: number;
  okCount: number;
  uptimePct: number;
  p50Ms: number | null;
  p95Ms: number | null;
  failStreak: number;
  lastOkAt: string | null;
  days: number;
};

export async function livenessSummary(): Promise<LivenessSummary> {
  const blank = {
    endpointsTracked: 0, probesRecorded: 0, probesToday: 0, answeringToday: 0,
    validatedToday: 0, daysOfHistory: 0, transitions: 0, transitionsToday: 0,
    p50Ms: null, p95Ms: null, errorClasses: [] as { cls: string; n: number }[],
  };
  const down = (reason: string): LivenessSummary => ({
    ...blank, unavailable: true, unavailableReason: reason,
  });

  const sql = db();
  if (!sql) return down("DATABASE_URL is not configured for this deployment");

  /**
   * Settled rather than all-or-nothing.
   *
   * Promise.all meant the error-class breakdown - the least important panel on
   * the page - could blank the headline counters by rejecting. It did exactly
   * that. Each query now degrades on its own, and only the failure of the
   * summary itself makes the page unavailable.
   */
  const [summary, events, errs] = await Promise.allSettled([
    guard(
      sql<any[]>`
        select
          count(distinct endpoint_id)::int                             as endpoints,
          coalesce(sum(probes), 0)::int                                as probes,
          coalesce(sum(probes) filter (where day = current_date), 0)::int   as probes_today,
          coalesce(sum(ok_count) filter (where day = current_date), 0)::int as ok_today,
          coalesce(sum(validated_count) filter (where day = current_date), 0)::int as validated_today,
          count(distinct day)::int                                     as days,
          percentile_disc(0.5) within group (order by p50_ms)           as p50,
          percentile_disc(0.95) within group (order by p95_ms)          as p95
        from probe_daily`,
      8000,
      null as any,
    ),
    guard(
      sql<any[]>`
        select count(*)::int as total,
               count(*) filter (where at >= current_date)::int as today
        from probe_events`,
      8000,
      null as any,
    ),
    /**
     * jsonb_typeof guard, not coalesce.
     *
     * coalesce substitutes for SQL NULL only. It does nothing for a JSON null or
     * a scalar, and 100 rows written on the first probe day hold a jsonb STRING
     * containing the text of the object - double-encoded by an early writer. Those
     * reached jsonb_each_text and threw "cannot call jsonb_each_text on a
     * non-object", which is what blanked the page.
     */
    guard(
      sql<any[]>`
        select key as cls, sum(value::int)::int as n
        from probe_daily, jsonb_each_text(err_counts)
        where jsonb_typeof(err_counts) = 'object'
        group by key order by n desc limit 8`,
      8000,
      null as any,
    ),
  ]);

  const s0 = summary.status === "fulfilled" ? summary.value : null;
  if (!s0) {
    return down(
      summary.status === "rejected"
        ? `probe_daily query failed: ${String((summary.reason as any)?.message ?? summary.reason).slice(0, 140)}`
        : "probe_daily query exceeded 8s",
    );
  }

  const s = s0[0] ?? {};
  const t = (events.status === "fulfilled" && events.value?.[0]) || {};
  const e = (errs.status === "fulfilled" && errs.value) || [];

  return {
    endpointsTracked: Number(s.endpoints ?? 0),
    probesRecorded: Number(s.probes ?? 0),
    probesToday: Number(s.probes_today ?? 0),
    answeringToday: Number(s.ok_today ?? 0),
    validatedToday: Number(s.validated_today ?? 0),
    daysOfHistory: Number(s.days ?? 0),
    transitions: Number(t.total ?? 0),
    transitionsToday: Number(t.today ?? 0),
    p50Ms: s.p50 == null ? null : Number(s.p50),
    p95Ms: s.p95 == null ? null : Number(s.p95),
    errorClasses: (e as any[]).map((x) => ({ cls: x.cls, n: Number(x.n) })),
    unavailable: false,
    unavailableReason: null,
  };
}

/** Recent state changes. The only place an agent going dark is recorded. */
export async function recentTransitions(limit = 40): Promise<Transition[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = await guard(sql<any[]>`
      select
        e.at, e.from_grade, e.to_grade, e.err_class, e.detail,
        ep.token_id::text as token_id, ep.url,
        a.name, o.registrable_domain as operator
      from probe_events e
      join agent_endpoints ep on ep.id = e.endpoint_id
      left join agents a on a.chain_id = ep.chain_id and a.token_id = ep.token_id
      left join operators o on o.key = a.operator_key
      order by e.at desc
      limit ${limit}
    `, 8000, [] as any[]);

    return rows.map((r) => ({
      at: new Date(r.at).toISOString(),
      tokenId: r.token_id ?? null,
      name: r.name ?? null,
      operator: r.operator ?? null,
      from: r.from_grade ?? null,
      to: r.to_grade,
      errClass: r.err_class ?? null,
      detail: r.detail ?? null,
      url: r.url ?? null,
      reason: humanReason(r.to_grade, r.err_class ?? null, r.detail ?? null),
    }));
  } catch {
    return [];
  }
}

/**
 * Measured uptime, with the observation count attached.
 *
 * An observation floor is enforced rather than implied: a percentage from two
 * probes is not uptime, and displaying it would be the flattering-number problem
 * the methodology page commits against.
 */
export async function uptimeTable(minProbes = 5, limit = 40): Promise<UptimeRow[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = await guard(sql<any[]>`
      select
        ep.token_id::text as token_id, ep.kind, ep.url,
        a.name, o.registrable_domain as operator,
        sum(d.probes)::int      as probes,
        sum(d.ok_count)::int    as ok_count,
        count(distinct d.day)::int as days,
        max(d.fail_streak)::int as fail_streak,
        max(d.last_ok_at)       as last_ok_at,
        percentile_disc(0.5) within group (order by d.p50_ms)  as p50,
        max(d.p95_ms)::int      as p95
      from probe_daily d
      join agent_endpoints ep on ep.id = d.endpoint_id
      left join agents a on a.chain_id = ep.chain_id and a.token_id = ep.token_id
      left join operators o on o.key = a.operator_key
      group by ep.token_id, ep.kind, ep.url, a.name, o.registrable_domain
      having sum(d.probes) >= ${minProbes}
      order by (sum(d.ok_count)::numeric / greatest(sum(d.probes), 1)) desc, sum(d.probes) desc
      limit ${limit}
    `, 8000, [] as any[]);

    return rows.map((r) => ({
      tokenId: r.token_id,
      name: r.name ?? null,
      operator: r.operator ?? null,
      kind: r.kind,
      probes: Number(r.probes),
      okCount: Number(r.ok_count),
      uptimePct: Number(((Number(r.ok_count) / Math.max(Number(r.probes), 1)) * 100).toFixed(2)),
      p50Ms: r.p50 == null ? null : Number(r.p50),
      p95Ms: r.p95 == null ? null : Number(r.p95),
      failStreak: Number(r.fail_streak ?? 0),
      lastOkAt: r.last_ok_at ? new Date(r.last_ok_at).toISOString() : null,
      days: Number(r.days ?? 0),
    }));
  } catch {
    return [];
  }
}
