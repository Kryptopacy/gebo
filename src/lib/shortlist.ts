/**
 * The shortlist: compare the agents you are considering for one job, in one
 * view, instead of walking back and forth between cards.
 *
 * DESIGN CONSTRAINTS (from the product spec's design laws, not preference):
 *
 *  - No winner, no composite score, no ordering input. L1/L3 ban scores and
 *    popularity ranking; a comparison that concludes for the user is the
 *    exact regression those laws exist to prevent. This surface aligns the
 *    same measured dimensions side by side and stops there - the judgement
 *    is the user's.
 *  - Unmeasured is not zero (invariant 9 / L2). Most of the chain's ~294k
 *    agents have no probes, no track record and no reviews; those cells say
 *    so with a reason, never a blank, never 0.
 *  - Every figure keeps its window and observation count (L2), because a
 *    side-by-side layout is precisely where a bare "99.1%" gets read as
 *    more comparable than it is.
 *
 * STATE LIVES IN THE URL (?ids=123,456), not client storage: the comparison
 * is shareable, bookmarkable, and survives the page's own links. The
 * localStorage on the agent card only ACCUMULATES ids between clicks; the
 * URL is the canonical state once you are here.
 */
import postgres from "postgres";
import { agentsByTokenIds, type Agent } from "./data.ts";
import type { MetricQualifier } from "./metrics.ts";

/** Beyond this the comparison stops being readable - six columns is a decision, twenty is a dump. */
export const MAX_SHORTLIST = 6;

const TOKEN_ID = /^\d{1,10}$/;

/**
 * Parse the ?ids= parameter: numeric token ids only, deduplicated, order
 * preserved (the order the user built is the order the columns render).
 * Deliberately does NOT cap - the page slices to MAX_SHORTLIST and discloses
 * what was dropped, because a silent cap is a quiet fabrication of a shorter
 * list than the user asked for.
 */
export function parseShortlistIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw).split(",")) {
    const t = part.trim();
    if (!TOKEN_ID.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Merge an ?add= parameter into the list. Idempotent (adding an id already
 * present is a no-op, not a duplicate), and reports a cap refusal so the page
 * can say "remove one first" instead of silently ignoring the request.
 */
export function addToShortlist(
  ids: string[],
  add: string | null | undefined,
): { ids: string[]; added: boolean; capped: boolean } {
  const t = (add ?? "").trim();
  if (!TOKEN_ID.test(t)) return { ids, added: false, capped: false };
  if (ids.includes(t)) return { ids, added: false, capped: false };
  if (ids.length >= MAX_SHORTLIST) return { ids, added: false, capped: true };
  return { ids: [...ids, t], added: true, capped: false };
}

/** The canonical href for a list of ids - the one form every internal link builds. */
export function shortlistHref(ids: string[]): string {
  return ids.length ? `/shortlist?ids=${ids.join(",")}` : "/shortlist";
}

// ── evidence reads ────────────────────────────────────────────────────────────
//
// Four reads, sequential, on ONE connection. The agent card answers one agent
// with seven parallel queries; a six-agent comparison that followed the same
// shape would open dozens of pooler round trips per render, and the free tier
// has already been throttled twice by exactly that pattern (AGENTS.md, the
// sustainable-fleet table). One connection, four round trips, bounded work.

export type ShortlistMetric = {
  metricId: string;
  value: number;
  qualifiers: MetricQualifier;
};

export type ShortlistAttest = {
  /** All attestations - same definition attestation_summary() uses on the card. */
  total: number;
  verified: number;
  succeeded: number;
  partial: number;
  failed: number;
  disputed: number;
  /**
   * Task runs with BOTH arms recorded, using taskRuns' filters (baseline
   * present, real attester). This is the /compare population, counted per
   * agent - labelled separately because it is a stricter claim than "has
   * attestations".
   */
  baselined: number;
};

export type ShortlistRead = {
  agents: Agent[];
  /** True when the agent read itself failed - the whole page degrades to a notice. */
  agentsUnavailable: boolean;
  agentsReason: string | null;
  /** tokenId -> liveness metrics that cleared the observation floor. */
  metrics: Map<string, ShortlistMetric[]>;
  metricsUnavailable: boolean;
  /** tokenId -> attestation counts. Absent key = none, which is a real finding. */
  attest: Map<string, ShortlistAttest>;
  attestUnavailable: boolean;
  /** tokenId -> verified review count. */
  reviews: Map<string, number>;
  reviewsUnavailable: boolean;
};

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

/**
 * Same qualifier validation as metrics.ts getAgentMetrics: a value whose
 * qualifiers did not survive the round trip does not render, because an L2
 * figure without its denominator is worse than no figure.
 */
function parseMetricRow(r: {
  metric_id: string;
  value: number | null;
  obs_count: number;
  qualifiers: MetricQualifier | string | null;
}): ShortlistMetric | null {
  if (r.value === null) return null;
  let q = r.qualifiers;
  if (typeof q === "string") {
    try { q = JSON.parse(q) as MetricQualifier; } catch { return null; }
  }
  if (!q || !q.formula || !q.denominator || !q.window ||
      typeof q.costTreatment !== "string" || !Array.isArray(q.knownDefects)) return null;
  return { metricId: r.metric_id, value: r.value, qualifiers: q };
}

export async function loadShortlist(tokenIds: string[]): Promise<ShortlistRead> {
  const ids = [...new Set(tokenIds.filter((t) => TOKEN_ID.test(t)))];
  const empty: ShortlistRead = {
    agents: [], agentsUnavailable: false, agentsReason: null,
    metrics: new Map(), metricsUnavailable: false,
    attest: new Map(), attestUnavailable: false,
    reviews: new Map(), reviewsUnavailable: false,
  };
  if (!ids.length) return empty;

  // 1. Agents (data.ts owns the shared AGENT_SELECT + row mapping).
  const agentRead = await agentsByTokenIds(ids);
  const read: ShortlistRead = {
    ...empty,
    agents: agentRead.agents,
    agentsUnavailable: agentRead.unavailable,
    agentsReason: agentRead.reason,
  };
  if (read.agentsUnavailable) return read;

  const sql = db();
  if (!sql) return read; // no DB: agents came from the file fallback; sections stay empty-but-measured

  // 2. Liveness metrics, all agents at once.
  try {
    const rows = await sql<{
      token_id: string;
      metric_id: string;
      value: number | null;
      obs_count: number;
      qualifiers: MetricQualifier | string | null;
    }[]>`
      select token_id::text as token_id, metric_id, value, obs_count, qualifiers
      from metric_values
      where chain_id = 56
        and token_id = any(${ids}::bigint[])
        and metric_id in ('uptime_7d', 'latency_p50_7d')
        and value is not null
    `;
    for (const r of rows) {
      const m = parseMetricRow(r);
      if (!m) continue;
      const list = read.metrics.get(r.token_id) ?? [];
      list.push(m);
      read.metrics.set(r.token_id, list);
    }
  } catch {
    read.metricsUnavailable = true;
  }

  // 3. Attestation counts, grouped. Mirrors attestation_summary()'s definition
  //    (no attester filter) so the numbers match the card; `baselined` adds
  //    taskRuns' stricter filters and is labelled as its own claim.
  try {
    const rows = await sql<{
      token_id: string;
      total: number;
      verified: number;
      succeeded: number;
      partial: number;
      failed: number;
      disputed: number;
      baselined: number;
    }[]>`
      select
        token_id::text as token_id,
        count(*)::int as total,
        count(*) filter (where evidence_verified)::int as verified,
        count(*) filter (where outcome = 'succeeded')::int as succeeded,
        count(*) filter (where outcome = 'partial')::int as partial,
        count(*) filter (where outcome = 'failed')::int as failed,
        count(*) filter (where outcome = 'disputed')::int as disputed,
        count(*) filter (
          where (baseline_duration_ms is not null or baseline_cost_amount is not null)
            and attester <> '0x0000000000000000000000000000000000000000'
        )::int as baselined
      from attestations
      where chain_id = 56 and token_id = any(${ids}::bigint[])
      group by token_id
    `;
    for (const r of rows) {
      read.attest.set(r.token_id, {
        total: Number(r.total),
        verified: Number(r.verified),
        succeeded: Number(r.succeeded),
        partial: Number(r.partial),
        failed: Number(r.failed),
        disputed: Number(r.disputed),
        baselined: Number(r.baselined),
      });
    }
  } catch {
    read.attestUnavailable = true;
  }

  // 4. Verified review counts, grouped. Counts are evidence volume, never a
  //    ranking input (L3); they render as "N verified review(s)" beside the
  //    explicit empty state.
  try {
    const rows = await sql<{ token_id: string; n: number }[]>`
      select token_id::text as token_id, count(*)::int as n
      from verified_reviews
      where token_id = any(${ids}::bigint[])
      group by token_id
    `;
    for (const r of rows) read.reviews.set(r.token_id, Number(r.n));
  } catch {
    read.reviewsUnavailable = true;
  }

  return read;
}
