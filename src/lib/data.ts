import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

/**
 * Data layer.
 *
 * Reads from Supabase when DATABASE_URL is set, and falls back to the NDJSON
 * in data/ when it is not, so the app stays runnable without a database.
 *
 * Connections go through the Supavisor transaction pooler, which does not
 * support prepared statements — hence `prepare: false`. Omitting that produces
 * intermittent "prepared statement already exists" errors that look like
 * random flakiness rather than a configuration mistake.
 */

export type Severity = "fatal" | "major" | "minor";
export type Grade = "validated" | "responded" | "failed";
export type TrustState = "VERIFIED" | "LISTED" | "DORMANT" | "SHADOWED";

export type Defect = { code: string; severity: Severity; detail: string };

export type Agent = {
  token_id: string;
  agent_id: string;
  name: string | null;
  owner_address: string;
  protocols: string[];
  x402: boolean;
  created_at: string;
  uri_scheme: string | null;
  token_uri: string | null;
  registration_resolved: boolean | null;
  registration_error: string | null;
  self_declared_active: boolean | null;
  supported_trust: string[] | null;
  operator: {
    key: string;
    kind: "host" | "owner" | "unknown";
    host: string | null;
    registrableDomain: string | null;
    owner: string | null;
    agentCount: number | null;
  };
  endpoints: { kind: "a2a" | "mcp" | "web"; url: string }[];
  lint: { defects: Defect[]; usable: boolean };
  probe: {
    kind: string;
    url: string;
    grade: Grade;
    httpStatus: number | null;
    rttMs: number;
    errClass: string;
    errDetail: string | null;
    evidence: Record<string, unknown> | null;
  } | null;
  scan: {
    health_score: number | null;
    health_status: unknown;
    is_active: boolean | null;
    endpoint_verified: boolean | null;
    total_score: number;
    total_feedbacks: number;
    quality: number | null;
    freshness: number | null;
  };
  trust_state: TrustState | null;
  trust_reason: string | null;
  category: string | null;
  category_matched: string[] | null;
  probed_at: string;
};

// ── categories ─────────────────────────────────────────────────────────────

export const CATEGORIES = {
  rebalancing: {
    slug: "rebalancing",
    job: "Keep my LP position in range",
    blurb: "Manages concentrated-liquidity ranges and resets positions when price drifts out of band.",
    venue: "PancakeSwap V3",
    keywords: ["rebalanc", "liquidity", "lp ", "concentrated", "range", "pancake", "uniswap", "pool", "position manager"],
    counterfactual: "against an unmanaged position and against simply holding, net of impermanent loss, gas and the agent's fee",
    floor: "30 rebalance events",
  },
  grid: {
    slug: "grid",
    job: "Trade a range automatically",
    blurb: "Places and manages grid orders inside a band, with a declared behaviour when price leaves it.",
    venue: "PancakeSwap · DEX",
    keywords: ["grid", "dca", "market mak", "spread", "band", "range trad", "scalp", "arbitrage"],
    counterfactual: "against holding over the same window, marked to market including open inventory",
    floor: "100 closed trades",
  },
  yield: {
    slug: "yield",
    job: "Move my capital to better yield",
    blurb: "Routes capital toward the highest sustainable rate, quoting the unboosted lower bound.",
    venue: "Venus · Aave V3 · Lista",
    keywords: ["yield", "apy", "apr", "farm", "vault", "stake", "staking", "optimi", "compound", "lend", "venus", "aave", "lista"],
    counterfactual: "against the best passive single-venue deposit, net of migration gas",
    floor: "10 migrations",
  },
  health: {
    slug: "health",
    job: "Stop my loan being liquidated",
    blurb: "Watches health factor and acts before liquidation, with declared oracle sources.",
    venue: "Venus · Aave V3",
    keywords: ["health factor", "liquidat", "collateral", "ltv", "borrow", "debt", "margin call", "loan", "monitor"],
    counterfactual: "against the no-agent outcome replayed over realised prices",
    floor: "one adverse regime observed",
  },
} as const;

export type CategorySlug = keyof typeof CATEGORIES;
export const CATEGORY_LIST = Object.values(CATEGORIES);

/**
 * Heuristic classification from the agent's name and declared protocols.
 * Weak by construction and labelled as such in the UI: registration files
 * rarely declare machine-readable capability, so anything stronger would be
 * invention rather than measurement.
 */
export function classify(a: Agent): { category: CategorySlug | null; matched: string[] } {
  if (a.category && a.category in CATEGORIES) {
    return { category: a.category as CategorySlug, matched: a.category_matched ?? [] };
  }
  const hay = `${a.name ?? ""} ${a.protocols.join(" ")}`.toLowerCase();
  let best: { category: CategorySlug; matched: string[] } | null = null;
  for (const c of CATEGORY_LIST) {
    const matched = c.keywords.filter((k) => hay.includes(k));
    if (matched.length && (!best || matched.length > best.matched.length)) {
      best = { category: c.slug as CategorySlug, matched };
    }
  }
  return best ?? { category: null, matched: [] };
}

export function trustState(a: Agent): { state: TrustState; reason: string } {
  if (a.trust_state) return { state: a.trust_state, reason: a.trust_reason ?? "" };
  const fatal = a.lint?.defects?.filter((d) => d.severity === "fatal") ?? [];
  if (fatal.length) {
    return {
      state: "SHADOWED",
      reason: fatal[0]!.code === "template_var"
        ? "registration contains an unsubstituted template variable — uncallable by any client"
        : fatal[0]!.detail,
    };
  }
  if (a.probe?.grade === "validated") return { state: "VERIFIED", reason: "completed a protocol handshake" };
  if (a.probe?.grade === "responded") return { state: "LISTED", reason: "server responded but did not speak the protocol" };
  return { state: "DORMANT", reason: a.probe?.errDetail ?? "no response" };
}

// ── loading ────────────────────────────────────────────────────────────────

let client: ReturnType<typeof postgres> | null = null;
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = postgres(url, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      // Fail fast rather than hanging a request. A slow pooler should degrade
      // the page to its fallback, never stall it past a serverless timeout.
      connect_timeout: 8,
      onnotice: () => {},
    });
  }
  return client;
}

/**
 * Bound any database read. Without this a cold or saturated pooler stalls the
 * whole render; the build already failed once at 60s for exactly this reason.
 */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let cache: Agent[] | null = null;

/**
 * jsonb columns can come back as a parsed value or, if they were written with
 * an extra JSON.stringify, as a JSON string. Normalise both, and never let a
 * malformed value crash a page render.
 */
function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch { return []; }
  }
  return [];
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch { return null; }
  }
  return null;
}

function fromFiles(): Agent[] {
  const dir = path.join(process.cwd(), "data");
  const rows: any[] = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.startsWith("census-") && x.endsWith(".ndjson"))) {
      for (const line of readFileSync(path.join(dir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line)); } catch { /* partial line */ }
      }
    }
  }
  const byId = new Map<string, Agent>();
  for (const r of rows) {
    const prev = byId.get(r.token_id);
    if (!prev || r.probed_at > prev.probed_at) {
      byId.set(r.token_id, { ...r, lint: { defects: asArray<Defect>(r.lint?.defects), usable: !!r.lint?.usable }, uri_scheme: r.uri_scheme ?? null, trust_state: null, trust_reason: null, category: null, category_matched: null });
    }
  }
  return [...byId.values()];
}

/**
 * One SELECT shared by every agent read, with the WHERE supplied by the caller.
 * Parameterised through sql.unsafe so the shape stays in a single place instead
 * of drifting across three near-identical queries.
 */
const AGENT_SELECT = `
  select
    a.token_id::text                             as token_id,
    a.agent_id,
    a.name,
    coalesce(a.owner, '')                        as owner_address,
    coalesce(a.protocols, '{}')                  as protocols,
    coalesce(a.x402_supported, false)            as x402,
    coalesce(a.registered_at, a.first_seen_at)   as created_at,
    a.uri_scheme,
    a.trust_state,
    a.trust_reason,
    a.category,
    a.category_matched,
    a.self_declared_active,
    a.supported_trust,
    a.token_uri,
    a.registration_resolved,
    a.registration_error,
    coalesce(a.lint_usable, false)               as lint_usable,
    coalesce(a.lint_defects, '[]'::jsonb)        as lint_defects,
    o.key                                        as op_key,
    o.kind                                       as op_kind,
    o.registrable_domain                         as op_domain,
    o.agent_count                                as op_agent_count,
    (
      select coalesce(json_agg(json_build_object('kind', e.kind, 'url', e.url) order by e.id), '[]'::json)
      from agent_endpoints e
      where e.chain_id = a.chain_id and e.token_id = a.token_id
    )                                            as endpoints,
    (
      select json_build_object(
        'kind', e.kind, 'url', e.url, 'grade', p.grade,
        'httpStatus', p.http_status, 'rttMs', p.rtt_ms,
        'errClass', p.err_class, 'errDetail', null, 'evidence', p.evidence
      )
      from probes_raw p
      join agent_endpoints e on e.id = p.endpoint_id
      where e.chain_id = a.chain_id and e.token_id = a.token_id
      order by p.at desc limit 1
    )                                            as probe,
    (
      select e.host from agent_endpoints e
      where e.chain_id = a.chain_id and e.token_id = a.token_id
      order by e.id limit 1
    )                                            as op_host
  from agents a
  left join operators o on o.key = a.operator_key
`;

function mapAgentRow(r: any): Agent {
  return {
    token_id: r.token_id,
    agent_id: r.agent_id,
    name: r.name,
    owner_address: r.owner_address,
    protocols: r.protocols ?? [],
    x402: r.x402,
    created_at: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
    uri_scheme: r.uri_scheme,
    token_uri: r.token_uri ?? null,
    registration_resolved: r.registration_resolved ?? null,
    registration_error: r.registration_error ?? null,
    self_declared_active: r.self_declared_active ?? null,
    supported_trust: r.supported_trust ?? null,
    operator: {
      key: r.op_key ?? "unknown",
      kind: (r.op_kind ?? "unknown") as Agent["operator"]["kind"],
      host: r.op_host ?? null,
      registrableDomain: r.op_domain ?? null,
      owner: r.owner_address || null,
      agentCount: r.op_agent_count ?? null,
    },
    endpoints: asArray(r.endpoints),
    lint: { defects: asArray<Defect>(r.lint_defects), usable: r.lint_usable },
    probe: r.probe ? { ...(r.probe as any), evidence: asObject((r.probe as any).evidence) } : null,
    scan: {
      health_score: null, health_status: null, is_active: null,
      endpoint_verified: null, total_score: 0, total_feedbacks: 0,
      quality: null, freshness: null,
    },
    trust_state: r.trust_state ?? null,
    trust_reason: r.trust_reason ?? null,
    category: r.category ?? null,
    category_matched: r.category_matched ?? null,
    probed_at: new Date().toISOString(),
  };
}

/**
 * Bounded agent read. Used only where a list is genuinely rendered — counts and
 * shares come from loadAggregates() instead of pulling rows.
 */
export async function loadAgents(limit = 400): Promise<Agent[]> {
  if (cache) return cache;
  const sql = db();
  if (!sql) { cache = fromFiles(); return cache; }
  try {
    const rows = await sql.unsafe(
      `${AGENT_SELECT}
       where a.chain_id = 56
       order by
         case a.trust_state when 'VERIFIED' then 0 when 'LISTED' then 1 when 'DORMANT' then 2 else 3 end,
         a.token_id desc
       limit $1`,
      [limit],
    );
    cache = (rows as any[]).map(mapAgentRow);
    return cache;
  } catch (err) {
    console.warn(`[data] database read failed, falling back to files: ${String(err).slice(0, 160)}`);
    cache = fromFiles();
    return cache;
  }
}

// ── aggregates ─────────────────────────────────────────────────────────────
// Computed in SQL rather than by loading rows. The registry holds 21k+
// endpoint-bearing agents; pulling them all into memory to count them would be
// wasteful locally and untenable on a serverless request.

export type Aggregates = {
  agents: number;
  states: Record<TrustState, number>;
  categories: Record<string, number>;
  operators: number;
  topOperators: { key: string; label: string; count: number; validated: number; broken: number }[];
  topOperatorShare: number;
};

let aggCache: Aggregates | null = null;

export async function loadAggregates(): Promise<Aggregates> {
  if (aggCache) return aggCache;
  const empty: Aggregates = {
    agents: 0,
    states: { VERIFIED: 0, LISTED: 0, DORMANT: 0, SHADOWED: 0 },
    categories: {}, operators: 0, topOperators: [], topOperatorShare: 0,
  };

  const sql = db();
  if (!sql) {
    // File fallback: derive from whatever rows we have.
    const rows = await loadAgents();
    const f = funnel(rows);
    aggCache = {
      agents: rows.length,
      states: {
        VERIFIED: f.validated, LISTED: f.responded,
        DORMANT: f.failed, SHADOWED: f.fatalDefects,
      },
      categories: {}, operators: f.distinctOperators,
      topOperators: f.topOperators.map((o) => ({ ...o, broken: 0 })),
      topOperatorShare: f.topOperatorShare,
    };
    return aggCache;
  }

  try {
    const results = await withTimeout(Promise.all([
      sql<{ n: number }[]>`select count(*)::int as n from agents where chain_id = 56`,
      sql<{ trust_state: string; n: number }[]>`
        select trust_state, count(*)::int as n from agents where chain_id = 56 group by trust_state`,
      sql<{ category: string | null; n: number }[]>`
        select category, count(*)::int as n from agents
        where chain_id = 56 and category is not null group by category`,
      sql<{ key: string; label: string; agent_count: number; validated_count: number; fatal_defect_count: number }[]>`
        select key, label, agent_count, validated_count, fatal_defect_count
        from operators where agent_count > 0 order by agent_count desc limit 10`,
      sql<{ n: number }[]>`select count(*)::int as n from operators where agent_count > 0`,
    ]), 9000, null as any);
    if (!results) { aggCache = empty; return aggCache; }
    const [counts, states, cats, ops, opCount] = results;

    const total = counts[0]?.n ?? 0;
    const st = { ...empty.states };
    for (const s of states) {
      if (s.trust_state in st) st[s.trust_state as TrustState] = s.n;
    }

    aggCache = {
      agents: total,
      states: st,
      categories: Object.fromEntries((cats as { category: string | null; n: number }[]).map((c) => [c.category!, c.n])),
      operators: opCount[0]?.n ?? 0,
      topOperators: (ops as { key: string; label: string; agent_count: number; validated_count: number; fatal_defect_count: number }[]).map((o) => ({
        key: o.key, label: o.label, count: o.agent_count,
        validated: o.validated_count, broken: o.fatal_defect_count,
      })),
      topOperatorShare: total && ops[0] ? (ops[0].agent_count / total) * 100 : 0,
    };
    return aggCache;
  } catch (err) {
    console.warn(`[data] aggregate read failed: ${String(err).slice(0, 140)}`);
    aggCache = empty;
    return aggCache;
  }
}

/** Agents for one category, ranked and operator-capped, without loading the rest. */
export async function agentsInCategory(category: CategorySlug, limit = 60): Promise<Agent[]> {
  const sql = db();
  if (!sql) {
    const all = await loadAgents();
    return diversify(rankAgents((agentsByCategory(all).get(category) ?? [])), 3).slice(0, limit);
  }
  try {
    const rows = (await sql.unsafe(
      `${AGENT_SELECT}
       where a.chain_id = 56 and a.category = $1
       order by
         case a.trust_state when 'VERIFIED' then 0 when 'LISTED' then 1 when 'DORMANT' then 2 else 3 end,
         a.token_id desc
       limit $2`,
      [category, limit],
    )) as unknown as any[];
    return diversify(rows.map(mapAgentRow), 3);
  } catch (err) {
    console.warn(`[data] category read failed: ${String(err).slice(0, 140)}`);
    return [];
  }
}

export async function findAgent(tokenId: string): Promise<Agent | undefined> {
  const sql = db();
  if (!sql) return (await loadAgents()).find((a) => a.token_id === tokenId);
  try {
    const rows = (await sql.unsafe(
      `${AGENT_SELECT} where a.chain_id = 56 and a.token_id = $1 limit 1`,
      [tokenId],
    )) as unknown as any[];
    return rows[0] ? mapAgentRow(rows[0]) : undefined;
  } catch {
    return (await loadAgents()).find((a) => a.token_id === tokenId);
  }
}

// ── opportunity surface ────────────────────────────────────────────────────
// Indexed from live chain state by scripts/index-opportunities.ts. This is the
// cold-start answer: a category page holds real work whether or not any
// competent agent exists to do it.

export type Opportunity = {
  id: string;
  category: CategorySlug;
  venue: string;
  ref: string;
  label: string;
  payload: Record<string, any>;
  eligible: boolean;
  ineligibleReason: string | null;
  updatedAt: string;
};

let oppCache: Opportunity[] | null = null;

export async function loadOpportunities(): Promise<Opportunity[]> {
  if (oppCache) return oppCache;
  const sql = db();
  if (!sql) { oppCache = []; return oppCache; }
  try {
    const rows = await sql<any[]>`
      select id, category, venue, ref, label, payload, eligible,
             ineligible_reason, updated_at
      from opportunities
      where chain_id = 56
      order by eligible desc, category, label
    `;
    oppCache = rows.map((r) => ({
      id: r.id,
      category: r.category as CategorySlug,
      venue: r.venue,
      ref: r.ref,
      label: r.label,
      payload: (asObject(r.payload) ?? {}) as Record<string, any>,
      eligible: r.eligible,
      ineligibleReason: r.ineligible_reason ?? null,
      updatedAt: typeof r.updated_at === "string" ? r.updated_at : new Date(r.updated_at).toISOString(),
    }));
    return oppCache;
  } catch (err) {
    console.warn(`[data] opportunity read failed: ${String(err).slice(0, 140)}`);
    oppCache = [];
    return oppCache;
  }
}

export async function opportunitiesFor(category: CategorySlug): Promise<Opportunity[]> {
  return (await loadOpportunities()).filter((o) => o.category === category);
}

/** Which payload fields each category surfaces, and how they are labelled. */
export const OPPORTUNITY_COLUMNS: Record<
  CategorySlug,
  { key: string; label: string; fmt: (v: any, p: Record<string, any>) => string; align?: "right" }[]
> = {
  rebalancing: [
    { key: "feePct", label: "Fee tier", fmt: (v) => (v == null ? "—" : `${v}%`), align: "right" },
    { key: "tickSpacing", label: "Tick spacing", fmt: (v) => (v == null ? "—" : String(v)), align: "right" },
    { key: "currentTick", label: "Current tick", fmt: (v) => (v == null ? "—" : Number(v).toLocaleString()), align: "right" },
    { key: "liquidity", label: "Active liquidity", fmt: (v) => (!v || v === "0" ? "none" : `${(Number(v) / 1e18).toPrecision(4)}e18`), align: "right" },
  ],
  grid: [
    { key: "feePct", label: "Fee tier", fmt: (v) => (v == null ? "—" : `${v}%`), align: "right" },
    { key: "currentTick", label: "Current tick", fmt: (v) => (v == null ? "—" : Number(v).toLocaleString()), align: "right" },
    { key: "observationCardinality", label: "Oracle slots", fmt: (v) => (v == null ? "—" : String(v)), align: "right" },
    { key: "unlocked", label: "Pool state", fmt: (v) => (v === false ? "locked" : "unlocked") },
  ],
  yield: [
    { key: "supplyAprPct", label: "Supply APR", fmt: (v) => (v == null ? "—" : `${Number(v).toFixed(2)}%`), align: "right" },
    { key: "borrowAprPct", label: "Borrow APR", fmt: (v) => (v == null ? "—" : `${Number(v).toFixed(2)}%`), align: "right" },
    { key: "utilisation", label: "Utilisation", fmt: (v) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`), align: "right" },
    { key: "collateralFactor", label: "Collateral factor", fmt: (v) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`), align: "right" },
  ],
  health: [
    { key: "collateralFactor", label: "Collateral factor", fmt: (v) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`), align: "right" },
    { key: "closeFactor", label: "Close factor", fmt: (v) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`), align: "right" },
    { key: "liquidationIncentive", label: "Liq. incentive", fmt: (v) => (v == null ? "—" : `${((Number(v) - 1) * 100).toFixed(1)}%`), align: "right" },
    { key: "borrowAprPct", label: "Borrow APR", fmt: (v) => (v == null ? "—" : `${Number(v).toFixed(2)}%`), align: "right" },
  ],
};

// ── population ─────────────────────────────────────────────────────────────
// Chain-wide figures from the registry census (docs/MEASUREMENTS.md §0), read
// directly from the ERC-8004 Identity Registry rather than sampled through an
// API. CENSUS.* is measured; POPULATION.* cross-references the 8004scan API.

export const CENSUS_FALLBACK = {
  tokensMinted: 270_200,
  censused: 270_200,
  resolved: 155_304,
  named: 155_297,
  claimActive: 153_454,
  withEndpoint: 759,
  callable: 362,
  operators: 76,
  owners: 228_421,
  ownersWithOneAgent: 216_931,
  largestOperatorShare: 55.7,
  top5OperatorShare: 87.0,
  top10OwnerShare: 7.44,
  declaresReputationTrust: 146_271,
  emptyTokenUri: 9_917,
  x402Supported: 13_702,
  fatalDefects: 12,
  uriSchemes: {} as Record<string, number>,
  endpointKinds: { web: 661, a2a: 330, mcp: 288 } as Record<string, number>,
  topOperators: [] as { domain: string; endpoints: number; callable: number }[],
  measuredAt: "2026-08-19",
  registry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
} as const;

export type Census = {
  tokensMinted: number; censused: number; resolved: number; named: number;
  claimActive: number; withEndpoint: number; callable: number;
  operators: number; owners: number; ownersWithOneAgent: number;
  largestOperatorShare: number; top5OperatorShare: number; top10OwnerShare: number;
  declaresReputationTrust: number; emptyTokenUri: number; x402Supported: number;
  fatalDefects: number;
  uriSchemes: Record<string, number>;
  endpointKinds: Record<string, number>;
  topOperators: { domain: string; endpoints: number; callable: number }[];
  measuredAt: string;
  registry: string;
  /** True when the figures came from the database rather than the fallback. */
  live: boolean;
};

let censusCache: Census | null = null;

/**
 * Census figures, read from the database at request time.
 *
 * These were previously hardcoded in three places plus the page metadata, which
 * meant every re-run of the census left stale numbers on a site whose whole
 * claim is that its figures are measured. scripts/analyse-census.ts writes the
 * row; nothing here is transcribed by hand.
 */
export async function loadCensus(): Promise<Census> {
  if (censusCache) return censusCache;

  const fallback: Census = {
    ...CENSUS_FALLBACK,
    uriSchemes: { ...CENSUS_FALLBACK.uriSchemes },
    endpointKinds: { ...CENSUS_FALLBACK.endpointKinds },
    topOperators: [...CENSUS_FALLBACK.topOperators],
    live: false,
  };

  const sql = db();
  if (!sql) { censusCache = fallback; return censusCache; }

  try {
    const rows = await withTimeout(
      sql<any[]>`
        select tokens_minted, censused, resolved, named, claim_active, with_endpoint,
               callable, operators, owners, owners_with_one_agent,
               largest_operator_share, top5_operator_share, top10_owner_share,
               declares_reputation, empty_token_uri, x402_supported, fatal_defects,
               uri_schemes, endpoint_kinds, top_operators, registry, measured_at
        from census_stats where id = 'bsc' limit 1
      `,
      7000,
      null as any,
    );
    const r = rows?.[0];
    if (!r) { censusCache = fallback; return censusCache; }

    const num = (v: any, d: number) => (v == null ? d : Number(v));
    censusCache = {
      tokensMinted: num(r.tokens_minted, fallback.tokensMinted),
      censused: num(r.censused, fallback.censused),
      resolved: num(r.resolved, fallback.resolved),
      named: num(r.named, fallback.named),
      claimActive: num(r.claim_active, fallback.claimActive),
      withEndpoint: num(r.with_endpoint, fallback.withEndpoint),
      callable: num(r.callable, fallback.callable),
      operators: num(r.operators, fallback.operators),
      owners: num(r.owners, fallback.owners),
      ownersWithOneAgent: num(r.owners_with_one_agent, fallback.ownersWithOneAgent),
      largestOperatorShare: num(r.largest_operator_share, fallback.largestOperatorShare),
      top5OperatorShare: num(r.top5_operator_share, fallback.top5OperatorShare),
      top10OwnerShare: num(r.top10_owner_share, fallback.top10OwnerShare),
      declaresReputationTrust: num(r.declares_reputation, fallback.declaresReputationTrust),
      emptyTokenUri: num(r.empty_token_uri, fallback.emptyTokenUri),
      x402Supported: num(r.x402_supported, fallback.x402Supported),
      fatalDefects: num(r.fatal_defects, fallback.fatalDefects),
      uriSchemes: (asObject(r.uri_schemes) ?? {}) as Record<string, number>,
      endpointKinds: (asObject(r.endpoint_kinds) ?? fallback.endpointKinds) as Record<string, number>,
      topOperators: asArray(r.top_operators),
      measuredAt: r.measured_at ? new Date(r.measured_at).toISOString().slice(0, 10) : fallback.measuredAt,
      registry: r.registry ?? fallback.registry,
      live: true,
    };
    return censusCache;
  } catch (err) {
    console.warn(`[data] census read failed, using fallback: ${String(err).slice(0, 140)}`);
    censusCache = fallback;
    return censusCache;
  }
}

export const POPULATION = {
  registeredBsc: 257_891,
  declaresMcp: 4_680,
  declaresA2a: 13_539,
  get callableUpperBound() { return this.declaresMcp + this.declaresA2a; },
  totalFeedbacksEver: 11_705,
  feedbacksToday: 0,
  newAgentsToday: 263,
  validationsEverAllChains: 0,
  measuredAt: "2026-08-18",
  registry: CENSUS_FALLBACK.registry,
  maxTokenId: CENSUS_FALLBACK.tokensMinted,
} as const;

export type Funnel = {
  sampled: number;
  validated: number;
  responded: number;
  failed: number;
  usable: number;
  fatalDefects: number;
  distinctOperators: number;
  topOperatorShare: number;
  topOperators: { key: string; label: string; count: number; validated: number }[];
};

export function funnel(agents: Agent[]): Funnel {
  const byState = (s: TrustState) => agents.filter((a) => trustState(a).state === s).length;
  const ops = new Map<string, { count: number; validated: number; label: string }>();
  for (const a of agents) {
    const key = a.operator?.key ?? "unknown";
    const label = a.operator?.registrableDomain ?? a.operator?.owner ?? "unknown";
    const e = ops.get(key) ?? { count: 0, validated: 0, label };
    e.count++;
    if (trustState(a).state === "VERIFIED") e.validated++;
    ops.set(key, e);
  }
  const sorted = [...ops.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count, validated: v.validated }))
    .sort((x, y) => y.count - x.count);

  return {
    sampled: agents.length,
    validated: byState("VERIFIED"),
    responded: byState("LISTED"),
    failed: byState("DORMANT"),
    usable: agents.filter((a) => a.lint?.usable).length,
    fatalDefects: byState("SHADOWED"),
    distinctOperators: ops.size,
    topOperatorShare: sorted.length && agents.length ? (sorted[0]!.count / agents.length) * 100 : 0,
    topOperators: sorted.slice(0, 8),
  };
}

export function agentsByCategory(agents: Agent[]) {
  const map = new Map<CategorySlug | "unclassified", Agent[]>();
  for (const c of CATEGORY_LIST) map.set(c.slug as CategorySlug, []);
  map.set("unclassified", []);
  for (const a of agents) {
    const { category } = classify(a);
    map.get(category ?? "unclassified")!.push(a);
  }
  return map;
}

/** Tiered, never popularity. See docs/PRODUCT_SPEC.md §5. */
export function rankAgents(agents: Agent[]): Agent[] {
  const tier = (a: Agent) => {
    const { state } = trustState(a);
    return state === "VERIFIED" ? 0 : state === "LISTED" ? 1 : state === "DORMANT" ? 2 : 3;
  };
  return [...agents].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    const ra = a.probe?.rttMs ?? Number.MAX_SAFE_INTEGER;
    const rb = b.probe?.rttMs ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

/** Cap slots per operator — concentration is the central finding. */
export function diversify<T extends Agent>(agents: T[], maxPerOperator = 3): T[] {
  const seen = new Map<string, number>();
  const head: T[] = [];
  const tail: T[] = [];
  for (const a of agents) {
    const k = a.operator?.key ?? "unknown";
    const n = seen.get(k) ?? 0;
    if (n < maxPerOperator) { head.push(a); seen.set(k, n + 1); }
    else tail.push(a);
  }
  return [...head, ...tail];
}
