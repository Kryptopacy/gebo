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
};

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
  const empty: LivenessSummary = {
    endpointsTracked: 0, probesRecorded: 0, probesToday: 0, answeringToday: 0,
    validatedToday: 0, daysOfHistory: 0, transitions: 0, transitionsToday: 0,
    p50Ms: null, p95Ms: null, errorClasses: [],
  };
  const sql = db();
  if (!sql) return empty;

  try {
    const res = await guard(Promise.all([
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
      sql<any[]>`
        select count(*)::int as total,
               count(*) filter (where at >= current_date)::int as today
        from probe_events`,
      sql<any[]>`
        select key as cls, sum(value::int)::int as n
        from probe_daily, jsonb_each_text(coalesce(err_counts, '{}'::jsonb))
        group by key order by n desc limit 8`,
    ]), 8000, null as any);

    if (!res) return empty;
    const [a, b, errs] = res;
    const s = a[0] ?? {};
    const t = b[0] ?? {};

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
      errorClasses: (errs as any[]).map((e) => ({ cls: e.cls, n: Number(e.n) })),
    };
  } catch {
    return empty;
  }
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
