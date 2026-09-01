/**
 * Drizzle schema for GEBO.
 *
 * Target: Supabase (managed Postgres). Connect through the Supavisor
 * transaction-mode pooler on port 6543, NOT the direct connection on 5432 —
 * serverless functions exhaust direct connections. Transaction-mode pooling
 * does not support prepared statements, so postgres-js is configured with
 * `prepare: false` in db.ts.
 *
 * Storage design note — this is the load-bearing decision:
 *
 *   Storing one row per probe is not viable. 18,219 callable agents at a
 *   15-minute cadence is ~1.75M rows/day, roughly 306 MB/day with row and
 *   index overhead, which exhausts a 500 MB free tier in under two days.
 *
 *   So raw probes are NOT the storage unit. We keep:
 *     probe_daily   — one row per agent per day, with counters and percentiles
 *     probe_events  — state transitions only (up→down, down→up), which are rare
 *     probes_raw    — optional 48h debugging window, rotated
 *
 *   Combined with the tiered probe cadence this is ~4,300 rows/day (~0.9 MB),
 *   which fits comfortably.
 */
import {
  pgTable, text, integer, bigint, boolean, timestamp, jsonb, real, smallint,
  primaryKey, index, uniqueIndex, date,
} from "drizzle-orm/pg-core";

// ── operators ──────────────────────────────────────────────────────────────
// Concentration is the central finding: 21 distinct hosts across 120 agents,
// with two operators holding 87% of the newest cohort. Operator is therefore a
// first-class entity, not a derived string.
export const operators = pgTable(
  "operators",
  {
    key: text("key").primaryKey(),                       // "host:termix.live" | "owner:0x…"
    kind: text("kind").notNull(),                        // host | owner | unknown
    registrableDomain: text("registrable_domain"),
    label: text("label").notNull(),
    agentCount: integer("agent_count").notNull().default(0),
    validatedCount: integer("validated_count").notNull().default(0),
    fatalDefectCount: integer("fatal_defect_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("operators_agent_count_idx").on(t.agentCount)],
);

// ── agents ─────────────────────────────────────────────────────────────────
export const agents = pgTable(
  "agents",
  {
    chainId: integer("chain_id").notNull(),
    tokenId: bigint("token_id", { mode: "bigint" }).notNull(),
    registry: text("registry").notNull(),                // 0x8004a169…a432 on BSC
    agentId: text("agent_id").notNull(),                 // {chainId}:{registry}:{tokenId}

    owner: text("owner"),
    agentWallet: text("agent_wallet"),
    /** ERC-8004 clears agentWallet on transfer — a trust-reset signal. */
    agentWalletVerified: boolean("agent_wallet_verified").default(false),

    tokenUri: text("token_uri"),
    uriScheme: text("uri_scheme"),                       // https | ipfs | data | empty | other
    registrationJson: jsonb("registration_json"),
    registrationResolved: boolean("registration_resolved").default(false),
    registrationError: text("registration_error"),

    name: text("name"),
    description: text("description"),
    protocols: text("protocols").array(),
    x402Supported: boolean("x402_supported").default(false),
    supportedTrust: text("supported_trust").array(),
    selfDeclaredActive: boolean("self_declared_active"),

    operatorKey: text("operator_key").references(() => operators.key),

    /** Trust state per PRODUCT_SPEC §2. Demote, never delete. */
    trustState: text("trust_state").notNull().default("DORMANT"),
    trustReason: text("trust_reason"),

    /** Heuristic classification — labelled as such in the UI. */
    category: text("category"),
    categoryMatched: text("category_matched").array(),

    lintUsable: boolean("lint_usable").default(false),
    lintDefects: jsonb("lint_defects"),

    registeredAt: timestamp("registered_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.tokenId] }),
    uniqueIndex("agents_agent_id_idx").on(t.agentId),
    index("agents_trust_state_idx").on(t.trustState),
    index("agents_category_idx").on(t.category),
    index("agents_operator_idx").on(t.operatorKey),
    index("agents_uri_scheme_idx").on(t.uriScheme),
  ],
);

// ── endpoints ──────────────────────────────────────────────────────────────
export const agentEndpoints = pgTable(
  "agent_endpoints",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenId: bigint("token_id", { mode: "bigint" }).notNull(),
    kind: text("kind").notNull(),                        // a2a | mcp | web
    url: text("url").notNull(),
    version: text("version"),
    host: text("host"),
    /** ERC-8004 optional /.well-known/agent-registration.json check. */
    domainVerified: boolean("domain_verified").default(false),
    /** Probe cadence tier: 0 hot (responded recently), 1 warm, 2 cold. */
    probeTier: smallint("probe_tier").notNull().default(1),
    nextProbeAt: timestamp("next_probe_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("agent_endpoints_agent_idx").on(t.chainId, t.tokenId),
    index("agent_endpoints_next_probe_idx").on(t.nextProbeAt, t.probeTier),
    index("agent_endpoints_host_idx").on(t.host),
  ],
);

// ── probe_daily: the rollup that uptime is computed from ───────────────────
export const probeDaily = pgTable(
  "probe_daily",
  {
    endpointId: bigint("endpoint_id", { mode: "number" }).notNull(),
    day: date("day").notNull(),
    probes: integer("probes").notNull().default(0),
    okCount: integer("ok_count").notNull().default(0),
    validatedCount: integer("validated_count").notNull().default(0),
    p50Ms: integer("p50_ms"),
    p95Ms: integer("p95_ms"),
    failStreak: integer("fail_streak").notNull().default(0),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    /** Counts keyed by error class — dns/timeout/tls/http_4xx/… */
    errCounts: jsonb("err_counts"),
  },
  (t) => [
    primaryKey({ columns: [t.endpointId, t.day] }),
    index("probe_daily_day_idx").on(t.day),
  ],
);

// ── probe_events: transitions only ─────────────────────────────────────────
export const probeEvents = pgTable(
  "probe_events",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    endpointId: bigint("endpoint_id", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    fromGrade: text("from_grade"),
    toGrade: text("to_grade").notNull(),
    httpStatus: integer("http_status"),
    errClass: text("err_class"),
    detail: text("detail"),
  },
  (t) => [index("probe_events_endpoint_idx").on(t.endpointId, t.at)],
);

// ── probes_raw: 48h debugging window, rotated ─────────────────────────────
export const probesRaw = pgTable(
  "probes_raw",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    endpointId: bigint("endpoint_id", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    grade: text("grade").notNull(),
    httpStatus: integer("http_status"),
    rttMs: integer("rtt_ms"),
    errClass: text("err_class"),
    evidence: jsonb("evidence"),
  },
  (t) => [index("probes_raw_at_idx").on(t.at)],
);

// ── on-chain reputation write-backs ────────────────────────────────────────
export const reputationWrites = pgTable(
  "reputation_writes",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenId: bigint("token_id", { mode: "bigint" }).notNull(),
    tag1: text("tag1").notNull(),                        // uptime | successRate
    value: integer("value").notNull(),
    valueDecimals: smallint("value_decimals").notNull(),
    feedbackUri: text("feedback_uri"),
    txHash: text("tx_hash"),
    writtenAt: timestamp("written_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("reputation_writes_agent_idx").on(t.chainId, t.tokenId)],
);

/** Reviewer allowlist — ERC-8004 getSummary requires filtering or it is Sybil-farmable. */
export const reviewers = pgTable("reviewers", {
  address: text("address").primaryKey(),
  trusted: boolean("trusted").notNull().default(false),
  note: text("note"),
});

// ── verified reviews: the L1 amendment — comments gated on completed escrow ─
export const verifiedReviews = pgTable(
  "verified_reviews",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    chainId: integer("chain_id").notNull(),              // APEX deployment the job lives on
    jobId: bigint("job_id", { mode: "bigint" }).notNull(), // the on-chain anchor
    tokenId: bigint("token_id", { mode: "bigint" }).notNull(),
    reviewer: text("reviewer").notNull(),                // the job's client, read from chain
    comment: text("comment").notNull(),                  // 16..2000 chars, evidence never a score
    jobStatus: smallint("job_status").notNull(),         // 3 = Completed at verification
    checkedBlock: bigint("checked_block", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("verified_reviews_one_per_job").on(t.chainId, t.jobId),
    index("verified_reviews_agent_idx").on(t.tokenId, t.createdAt),
  ],
);

// ── opportunity surface: indexed reality, not submissions ──────────────────
export const opportunities = pgTable(
  "opportunities",
  {
    id: text("id").primaryKey(),                         // category:chain:venue:ref
    category: text("category").notNull(),                // rebalancing|grid|yield|health
    chainId: integer("chain_id").notNull(),
    venue: text("venue").notNull(),
    ref: text("ref").notNull(),
    label: text("label").notNull(),
    payload: jsonb("payload").notNull(),
    eligible: boolean("eligible").notNull().default(true),
    ineligibleReason: text("ineligible_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("opportunities_category_idx").on(t.category, t.eligible),
    index("opportunities_updated_idx").on(t.updatedAt),
  ],
);

// ── Altana sessions: blast radius ──────────────────────────────────────────
export const sessions = pgTable(
  "sessions",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    chainId: integer("chain_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    sessionPublicKey: text("session_public_key").notNull(),
    /** Byte-exact grant commitment. Never re-serialise — Altana matches bytes. */
    canonicalJson: text("canonical_json").notNull(),
    state: text("state").notNull().default("active"),    // active | expired | revoked
    expiry: timestamp("expiry", { withTimezone: true }),
    /** True when calls[] is absent: session may hit ANY contract within its cap. */
    unbounded: boolean("unbounded").notNull().default(false),
    callAllowlist: jsonb("call_allowlist"),
    spendCaps: jsonb("spend_caps"),
    grantTxHash: text("grant_tx_hash"),
    revokeTxHash: text("revoke_tx_hash"),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sessions_key_idx").on(t.chainId, t.sessionPublicKey),
    index("sessions_wallet_idx").on(t.walletAddress),
    index("sessions_unbounded_idx").on(t.unbounded),
  ],
);

// ── metric values: qualifiers travel WITH the value (design law L2) ────────
export const metricValues = pgTable(
  "metric_values",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenId: bigint("token_id", { mode: "bigint" }).notNull(),
    metricId: text("metric_id").notNull(),
    /** "window" is reserved in Postgres; Drizzle quotes identifiers, so this is safe. */
    window: text("window").notNull(),
    value: real("value"),
    obsCount: integer("obs_count").notNull(),
    /** NOT NULL by design: denominator, window, cost treatment, n. */
    qualifiers: jsonb("qualifiers").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("metric_values_unique_idx").on(t.chainId, t.tokenId, t.metricId, t.window),
  ],
);
