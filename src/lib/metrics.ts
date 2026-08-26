/**
 * Metric values: the only path a performance number may take to the UI.
 *
 * Design law L2 says no metric renders without its denominator, window, cost
 * treatment and observation count. Enforcing that at render time is discipline,
 * which decays; enforcing it in storage is structure, which does not. So every
 * value is written with its qualifiers in the same row, and the reader returns
 * that bundle or nothing - there is no code path that produces a bare number.
 *
 * Scope here is liveness metrics only (uptime, latency). Counterfactual edge,
 * PnL and drawdown need agent_actions, which do not exist yet; when they do,
 * they join this registry rather than inventing a second one.
 *
 * The observation floor (20 probes over the window) is enforced at WRITE time:
 * an agent below the floor gets no row, and the card renders "insufficient
 * observations" from the absence. A stored 63.2% from n=6 would be exactly the
 * flattering number L2 exists to prevent.
 */
import postgres from "postgres";

/** The window this module computes. Widening it means re-reading the defects. */
export const WINDOW = "7d";

/** Below this many observations in the window, nothing is written. */
export const OBS_FLOOR = 20;

export type MetricQualifier = {
  formula: string;
  denominator: string;
  window: string;
  costTreatment: string;
  obsCount: number;
  obsFloor: number;
  knownDefects: string[];
};

export type MetricValue = {
  metricId: string;
  window: string;
  /** Null never reaches the UI through this type: null rows are not written. */
  value: number;
  qualifiers: MetricQualifier;
  computedAt: string;
};

/**
 * The registry. Anything not described here does not get computed, and anything
 * computed without these fields fails the qualifier check below.
 */
const DEFS = {
  uptime_7d: {
    display: "Uptime",
    formula: "probes answered without failure / all probes sent",
    denominator: "all probes sent to any declared endpoint of this agent",
    costTreatment: "not applicable - reachability carries no cost basis",
    knownDefects: [
      "Single-region vantage: an agent up everywhere but unreachable from us counts as down.",
      "A handshake validates the interface, not the quality of the work behind it.",
    ],
  },
  latency_p50_7d: {
    display: "Response time p50",
    formula: "median across days of each day's median round-trip",
    denominator: "successful probes in the window",
    costTreatment: "not applicable",
    knownDefects: [
      "Includes network path, not just agent compute.",
      "Daily medians are averaged into a weekly figure by the rollup, so intra-day tails are lost.",
    ],
  },
  latency_p95_7d: {
    display: "Response time p95",
    formula: "worst daily p95 recorded in the window",
    denominator: "successful probes in the window",
    costTreatment: "not applicable",
    knownDefects: [
      "The rollup keeps a running maximum per day, so this is an upper bound on the true weekly p95.",
      "Includes network path and cold starts on serverless hosts.",
    ],
  },
} as const;

export type MetricId = keyof typeof DEFS;

/** Every L2 field present and non-empty, or the value cannot be written. */
export function buildQualifiers(metricId: MetricId, obsCount: number): MetricQualifier {
  const def = DEFS[metricId];
  return {
    formula: def.formula,
    denominator: def.denominator,
    window: WINDOW,
    costTreatment: def.costTreatment,
    obsCount,
    obsFloor: OBS_FLOOR,
    knownDefects: [...def.knownDefects],
  };
}

function pct(ok: number, n: number): number {
  return Math.round((ok / Math.max(n, 1)) * 10000) / 100;
}

/**
 * Materialise liveness metrics for every agent whose evidence clears the floor.
 *
 * Runs after each probe batch, so the numbers move as the data does and no
 * separate scheduler is needed. One aggregate pass, three metrics per agent.
 */
export async function computeLivenessMetrics(
  sql: postgres.Sql,
): Promise<{ agents: number; written: number }> {
  // jsonb_build_object per metric id keeps each row's qualifiers exact rather
  // than shared; the case expressions are verbose but honest about provenance.
  await sql`
    with win as (
      select ep.chain_id, ep.token_id,
             sum(d.probes)::int            as n,
             sum(d.ok_count)::int          as ok,
             percentile_disc(0.5) within group (order by d.p50_ms) as p50,
             max(d.p95_ms)::int            as p95
      from probe_daily d
      join agent_endpoints ep on ep.id = d.endpoint_id
      where d.day >= current_date - 7
      group by ep.chain_id, ep.token_id
      having sum(d.probes) >= ${OBS_FLOOR}
    ), metrics as (
      select w.*, m.id as metric_id,
        case m.id
          when 'uptime_7d'       then round((w.ok::numeric * 100) / greatest(w.n, 1), 2)
          when 'latency_p50_7d'  then w.p50
          else w.p95
        end::real as val
      from win w cross join (values ('uptime_7d'), ('latency_p50_7d'), ('latency_p95_7d')) as m(id)
    )
    insert into metric_values
      (chain_id, token_id, metric_id, "window", value, obs_count, qualifiers, computed_at)
    select chain_id, token_id, metric_id, ${WINDOW}, val, n,
      -- Parameters below carry explicit casts: jsonb_build_object is variadic
      -- "any", so Postgres cannot infer parameter types from context.
      jsonb_build_object(
        'formula',
        case metric_id
          when 'uptime_7d'      then ${(DEFS.uptime_7d as { formula: string }).formula}::text
          when 'latency_p50_7d' then ${(DEFS.latency_p50_7d as { formula: string }).formula}::text
          else ${(DEFS.latency_p95_7d as { formula: string }).formula}::text
        end,
        'denominator',
        case metric_id
          when 'uptime_7d'      then ${(DEFS.uptime_7d as { denominator: string }).denominator}::text
          when 'latency_p50_7d' then ${(DEFS.latency_p50_7d as { denominator: string }).denominator}::text
          else ${(DEFS.latency_p95_7d as { denominator: string }).denominator}::text
        end,
        'window', ${WINDOW}::text,
        'costTreatment', 'not applicable',
        'obsCount', n,
        'obsFloor', ${OBS_FLOOR}::int,
        'knownDefects',
        case metric_id
          when 'uptime_7d'      then ${sql.json([...DEFS.uptime_7d.knownDefects])}::jsonb
          when 'latency_p50_7d' then ${sql.json([...DEFS.latency_p50_7d.knownDefects])}::jsonb
          else ${sql.json([...DEFS.latency_p95_7d.knownDefects])}::jsonb
        end
      ),
      now()
    from metrics
    on conflict (chain_id, token_id, metric_id, "window") do update set
      value = excluded.value,
      obs_count = excluded.obs_count,
      qualifiers = excluded.qualifiers,
      computed_at = now()
  `;

  // An agent can fall below the floor after earlier good weeks. Stale rows would
  // keep rendering a percentage the current evidence no longer supports.
  await sql`
    delete from metric_values
    where metric_id in ('uptime_7d', 'latency_p50_7d', 'latency_p95_7d')
      and computed_at < now() - interval '26 hours'
  `;

  const [row] = await sql<{ agents: number; written: number }[]>`
    select count(distinct (chain_id, token_id))::int as agents,
           count(*)::int as written
    from metric_values where "window" = ${WINDOW}`;
  return { agents: Number(row?.agents ?? 0), written: Number(row?.written ?? 0) };
}

/**
 * Read one agent's metrics WITH their qualifiers. Returns [] when nothing has
 * cleared the floor - the caller renders absence honestly instead.
 */
export async function getAgentMetrics(
  sql: postgres.Sql,
  chainId: number,
  tokenId: bigint | string,
): Promise<MetricValue[]> {
  const rows = await sql`
    select metric_id, "window", value, obs_count, qualifiers, computed_at
    from metric_values
    where chain_id = ${chainId} and token_id = ${String(tokenId)}::bigint and value is not null
    order by metric_id` as {
    metric_id: string;
    window: string;
    value: number | null;
    obs_count: number;
    qualifiers: MetricQualifier | string | null;
    computed_at: Date;
  }[];

  return rows.flatMap((r: {
    metric_id: string; window: string; value: number | null; obs_count: number;
    qualifiers: MetricQualifier | string | null; computed_at: Date;
  }) => {
    if (r.value === null) return [];
    // Poolers may deliver jsonb pre-serialised; parse rather than assume.
    let q = r.qualifiers as MetricQualifier | null;
    if (typeof q === "string") {
      try { q = JSON.parse(q) as MetricQualifier; } catch { return []; }
    }
    if (!q || !q.formula || !q.denominator || !q.window ||
        typeof q.costTreatment !== "string" || !Array.isArray(q.knownDefects)) return [];
    return [{
      metricId: r.metric_id,
      window: r.window,
      value: r.value,
      qualifiers: q,
      computedAt: new Date(r.computed_at).toISOString(),
    }];
  });
}

export { pct };

/** Exposed so /methodology renders definitions from the same source of truth. */
export const METRIC_DEFS = DEFS;

// ── page-facing convenience ─────────────────────────────────────────────────

let client: ReturnType<typeof postgres> | null = null;
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = postgres(url, {
      prepare: false, max: 2, idle_timeout: 20, connect_timeout: 8, onnotice: () => {},
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

/**
 * Metrics for one agent, safe for direct use in a server component.
 *
 * Returns [] on any failure - and the caller must render that as "could not be
 * measured" rather than as zero, per invariant 9. Absence here means either
 * "below the floor" or "the read failed"; both are rendered as no-figure-with-
 * reason, never as a number.
 */
export async function agentMetrics(
  chainId: number,
  tokenId: string,
): Promise<MetricValue[]> {
  const sql = db();
  if (!sql) return [];
  try {
    return await guard(getAgentMetrics(sql, chainId, tokenId), 8000, []);
  } catch {
    return [];
  }
}
