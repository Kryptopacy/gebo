# GEBO — Product Specification

Companion to `STRATEGY.md`. Every decision here traces to a research finding in that document.
Stack: **Next.js App Router · TypeScript · viem · Supabase (Postgres) + Drizzle**

---

## 0. Design law

Nine rules. Violating any one of them reproduces a documented failure.

| # | Law | Source |
| --- | --- | --- |
| **L1** | **No unanchored ratings; no review-derived scores or ranking. Anywhere.** Verified reviews exist only as free-text comments gated on a completed escrow job — displayed as evidence, never aggregated, never a sort key. | Cor(usage, rating) = −0.153…+0.071 in the GPT Store — noise from self-selected, unverified raters; the completed-job anchor is what the GPT Store lacked |
| **L2** | **No metric renders without all four of: denominator, window, cost treatment, observation count.** A metric missing any one renders as `—` with a reason. | TradingView cost-realism rules; DefiLlama typed fields |
| **L3** | **Never rank by popularity, usage count, follower count, or TVL.** | Cor(usage, rating-count) = 0.33–0.71 → rich-get-richer, uncorrelated with quality |
| **L4** | **Listings are named after the user's job, never the technology.** | Zapier's converting unit vs the GPT Store's "DALL·E" category |
| **L5** | **The Agent Card is a compatibility/security sheet + worked example, not a landing page.** | Verbatim user demand, r/AI_Agents ≈Jun 2026 |
| **L6** | **Quote the lower bound by default.** Unboosted, tradable-rewards-only, slashed-on-exit, net of all costs. | DefiLlama "minimum attainable yield" doctrine |
| **L7** | **Demote, never delete.** Three visibility states, severity-mapped. | TradingView Suggested/Unsuggested/Hidden |
| **L8** | **Mark-to-market including open positions.** Closed-position-only PnL is banned. | Binance copy-trading's documented deception; "100% win rate if I never close my losers" |
| **L9** | **Every number's definition and its known defects are published.** | Hugging Face publishes its own metric's defects (GGUF double-count) |

> **L1 amendment (2026-08-31).** The GPT Store measurement condemns *unanchored*
> ratings — self-selected raters, no proof of use — not reviews as such. A review
> gated on a completed APEX escrow job changes the data-generating process: a fake
> review then costs ~7 transactions + gas + a dispute window, instead of 0.01 $U
> for an x402 interaction. Reviews are therefore permitted as hire-anchored
> **comments** (off-chain storage, the jobId as the on-chain anchor) carrying the
> one dimension neither probes nor the escrow evaluator measure —
> did-it-do-what-the-brief-said. Stars, scores, averages and review-derived
> ranking remain banned; L3 blocks the count-based variant independently.

---

## 1. Information architecture

Judged journey: **land → find by category → understand → activate**, with *"someone with zero Agent Studio knowledge… without hitting a dead end."*

```
/                              Landing = the discovery surface itself
/c/[category]                  Category surface (4 judged + 5 more, equal depth)
/c/[category]                  Tabbed: Agents · Opportunities · How it works
/categories                    All categories, one index
/o/[opportunityId]             Opportunity detail (a pool / market / position)
/a/[tokenId]                   Agent Card (tokenId keys the ERC-8004 identity)
/a/[tokenId]/hire              Activation flow: scope → simulate → hire → revoke
                               (the dry run folded into step 02 — no separate route)
/search                        Capability search (full-text over skills/docs/name)
/shortlist                     Side-by-side comparison of up to 6 agents (?ids=)
                               (the "understand" step, plural: aligned measured
                               dimensions, no score, no winner — L1/L3 apply)
/authority                     My Agents — live sessions, blast radius, revoke
/compare                       Agent Advantage — counterfactual engine (serves TermiX)
/methodology                   Every definition + known defects
/live                          Proof-of-Life ledger (public liveness feed)
```

> As-built note (2026-08-30): routes are keyed by `tokenId` alone (chain is
> fixed at 56 for the registry), the simulation lives inside the hire flow's
> step 02, and background work runs as `pg_cron` jobs calling Next API routes
> (see docs/OPERATIONS.md) rather than the Bun workers sketched in §8.

> As-built note (2026-09-09): `/shortlist` implements the comparison step the
> journey implied but never had — deciding between candidates used to mean
> walking cards in separate tabs. State is the URL (`?ids=` token ids, capped
> at six with the cap disclosed), entered from an "Add to shortlist" button on
> each agent card or by pasting ids. It aligns the card's measured dimensions
> (trust state, handshake, uptime/latency with observation counts, attestation
> counts, verified reviews) and deliberately concludes nothing: no composite
> score, no "best pick", no popularity ordering (L1/L3); unmeasured dimensions
> render as unmeasured with a reason (L2/invariant 9). Evidence loads as four
> bounded queries on one connection, not per-agent fan-out — the free-tier
> throttle lesson.

### 1.1 `/` — Landing

Not a hero + testimonials. The landing **is** the surface. Four things, in this order:

1. **One sentence stating the job.** "Find an agent to run your BSC positions. See exactly what it can and cannot do to your wallet before you authorise it."
2. **The trust counter** — our headline, computed not claimed. Live 8004scan figures as of 2026-08-18:
   ```
   257,832  agents registered on BSC          ← their number
    18,213  are even callable (7.1%)          ← MCP or A2A declared
       ···  responded to a probe today        ← our number
       ···  have a verifiable track record    ← the product
   ```
   The second line is doing quiet, devastating work: **93% of the chain's agents declare no machine-callable endpoint at all.** Supporting facts for the copy: 11,705 feedbacks ever across 257,832 agents (0.045 each), **0 feedbacks today**, and the single highest-scoring agent on BSC sits at **49.04/100** with 3 reviews. This component is the entire differentiation, above the fold. It reframes the category in one glance and is the honest reading of "data quality beyond basic counts."
3. **Four category tiles, equal visual weight** (L4-named, live counts, never zero-state):
   `Keep my LP in range` · `Trade a range automatically` · `Move my capital to better yield` · `Stop my loan being liquidated`
4. **"How this works" in three lines** — for the zero-knowledge judge. Grant a scoped key → agent acts inside limits enforced on-chain → revoke in one transaction.

**Dead-end prevention:** every tile has a guaranteed non-empty state. If no agent in a category is `Verified`, the tile shows the *opportunity surface* count instead ("1,204 PancakeSwap V3 positions currently out of range") and routes to the category page, which is never empty because it indexes reality (§3).

### 1.2 `/c/[category]` — Category surface

Two panes. This is the DefiLlama transplant and it is why we have no cold start.

```
┌─ LEFT: OPPORTUNITY SURFACE (indexed reality, never empty) ─┬─ RIGHT: AGENTS ──────────┐
│ Real on-chain rows. Sortable, faceted.                     │ Agents that can act on   │
│ e.g. CAKE/USDT 0.05% · TVL $2.1M · fee APR 18.4% ·          │ the selected row.        │
│      position 34% out of range · 12 stale positions        │ Tiered, never popularity │
│ Selecting a row filters the right pane.                    │ sorted (§5).             │
└────────────────────────────────────────────────────────────┴──────────────────────────┘
```

Facets (all server-side, all from real data): liveness state · verification tier · blast-radius tightness · counterfactual edge · observation count · settlement model · venue · risk profile.

**Four category pages must be structurally identical and equally deep.** Same components, same facet count, same metric density. Rubric: *"a submission that treats one category as the main event and the rest as an afterthought won't score well."* Build one generic `<CategorySurface>` parameterised by a category descriptor — this makes equal depth structural rather than a discipline problem.

### 1.3 `/a/[chainId]/[agentId]` — Agent Card

**Section order is deliberate: safety before performance.** Every competitor will lead with performance.

| Order | Section | Contents |
| --- | --- | --- |
| 1 | **Job header** | L4 job name · one-line testable claim · category · venue icons (Zapier's provenance-by-integration trust signal) |
| 2 | **Liveness strip** | Responding now? · uptime 7d/30d · p50/p95 latency · last successful response · consecutive failures · sparkline. **Ours, not resold.** |
| 3 | **Blast Radius** | §4. Enforced authority, read from Keystore. `⚠ UNBOUNDED` if no call allowlist. |
| 4 | **What it does** | Worked example: real inputs → real outputs, with tx hashes. Trigger conditions. Decision inputs (oracles, thresholds) — answers *"you cannot see or edit their full context."* |
| 5 | **Track record** | §6 metrics, each with its four qualifiers. Counterfactual vs the category's honest alternative. Renders `Insufficient observations (n=7, floor=30)` rather than a flattering number. |
| 6 | **Failure modes** | What breaks it · behaviour on venue pause · behaviour on oracle staleness · range-exit behaviour · **"who should NOT use this"** |
| 7 | **Provenance** | Owner · transfer history · `agentWallet` verified/cleared · endpoint domain verified (`/.well-known/agent-registration.json`) · registration age · last `agentURI` update |
| 8 | **Settlement** | ERC-8183 escrow terms or x402 per-call price · who the evaluator is · refund conditions |
| 9 | **Actions** | `Dry run` (primary) · `Hire` (secondary, disabled until dry run) · `Report` |

### 1.4 `/a/[...]/hire` — Activation, four steps

```
1 SCOPE     Pick from 3 preset limits (Conservative / Standard / Custom).
            Show the resulting Blast Radius live as they adjust. Diff on every change.
2 SIMULATE  Dry-run the agent's next action against current BSC state. Show the
            exact calls, token deltas, gas, slippage. "Nothing has been signed yet."
3 GRANT     One signature. Explicitly enumerate what was granted, in plain language.
4 CONFIRM   Keystore tx hash · independent verification link (Altana explorer) ·
            revoke button present from this second onward.
```

Step 4 shows the revoke control **immediately**. Users must never have to hunt for it.

### 1.5 `/authority` — My Agents

The console every incident in the research implies. Per active session: agent, blast radius, spend consumed vs cap for the current period, time to expiry, last action, `Revoke` (one tx). Plus a **global kill switch** that revokes every session in one batch.

### 1.6 `/methodology`

Every metric: formula, window, denominator, cost treatment, observation floor, **and its known defects**. Plus the reviewer-trust set used for reputation filtering and why (ERC-8004 forbids unfiltered aggregation). This page is cheap to build and disproportionately credible — HF's counting doc is the model.

---

## 2. Trust state machine

```
                    ┌──────────────┐
   probe fails ×N   │              │  meets Verified gate
  ┌─────────────────┤   LISTED     ├──────────────────────┐
  │                 │ direct link  │                      │
  ▼                 │ only, no     │                      ▼
┌──────────┐        │ discovery    │              ┌──────────────┐
│  DORMANT │        └──────┬───────┘              │   VERIFIED   │
│ no probe │               │ ▲                    │ discoverable │
│ response │               │ │ recovers           │ + featurable │
└──────────┘               ▼ │                    └──────┬───────┘
                    ┌──────────────┐                     │ violation
   deception,       │  SHADOWED    │◄────────────────────┘
   overclaim,  ────►│ frozen, can  │
   unbounded+loss   │ not update   │
                    └──────────────┘
```

**Gates.** `Verified` requires *all*: responding now · uptime ≥ 95% over 7d · call allowlist present (not unbounded) · spend cap present · observation count ≥ category floor · all displayed metrics carry their four qualifiers · no unsubstantiated performance claim.

`Shadowed` is terminal and cannot be updated (TradingView's rule — it makes deception expensive). Triggers: unsubstantiated performance claim, metric gaming, plagiarised listing, unbounded session that incurred a user loss.

`DORMANT` agents are **counted publicly but excluded from discovery.** They are the 199,950. Being able to *state* that number is the product.

---

## 3. Opportunity surface schemas — index reality, don't solicit listings

Populated from chain before any agent exists. This is the cold-start answer.

```ts
// Shared base
type Opportunity = {
  id: string;                 // `${category}:${chainId}:${venue}:${ref}`
  category: CategoryId;
  chainId: 56 | 97;
  venue: 'pancakeswap-v3' | 'venus' | 'aave-v3' | 'lista';
  ref: string;                // pool address | market address | position tokenId
  label: string;              // human: "CAKE/USDT 0.05%"
  updatedAt: Date;            // staleness is a first-class field
  eligible: boolean;          // passes the category floor (§3.5)
  ineligibleReason?: string;  // never silently drop a row
};
```

### 3.1 Rebalancing — PancakeSwap V3

```ts
type RebalanceOpportunity = Opportunity & {
  token0: Address; token1: Address;
  feeTier: 100 | 500 | 2500 | 10000;      // 0.01% | 0.05% | 0.25% | 1%
  tickSpacing: number;                     // derived from feeTier — verify on-chain
  tvlUsd: number;
  feeAprBase: number;                      // from realised 24h fees / TVL
  cakeAprReward: number | null;            // MasterChefV3 farm, if any
  rewardTradable: boolean;                 // L6: exclude if not
  realisedVol7d: number;
  currentTick: number;
  // position-level, when scoped to a user position
  positionTokenId?: bigint;
  isStakedInMasterChefV3?: boolean;         // ← CRITICAL. NFT held by 0x556B93…c59e
  pctOutOfRange?: number;
  uncollectedFees0?: bigint; uncollectedFees1?: bigint;
  pendingCake?: bigint;
};
```

> **`isStakedInMasterChefV3` is the highest-value field in this schema.** A staked position's NFT is owned by MasterChefV3, so rebalancing is withdraw → modify → re-stake and CAKE harvest must enter the accounting. Competitors calling `decreaseLiquidity` directly will silently fail on farmed positions. Surface it as a badge on the row.

### 3.2 Grid trading

```ts
type GridOpportunity = Opportunity & {
  pair: [Address, Address];
  realisedVol7d: number; realisedVol30d: number;
  spreadBps: number;
  depthUsdAt1Pct: number;                  // capacity constraint
  rangeBreakFreq30d: number;               // times price left a ±1σ band
  suggestedBandLower: number; suggestedBandUpper: number;
  ruinProbabilityEstimate: number;         // explicit user demand, r/algotrading
};
```

### 3.3 Yield optimisation

```ts
type YieldOpportunity = Opportunity & {
  asset: Address;
  apyBase: number;                         // DefiLlama split — never one number
  apyReward: number;
  rewardTokens: Address[];
  rewardTradable: boolean;                 // L6
  rewardLocked: boolean;                   // L6: excluded from apyReward if true
  apyUnboosted: number;                    // L6: the number we display
  utilisation: number;
  supplyCapUsd: number | null;
  isIntrinsicSource: boolean;              // LST native yield feeding a downstream market
  dependsOn: string[];                     // dependency graph, not a flat number
};
```

### 3.4 Health factor

```ts
type HealthOpportunity = Opportunity & {
  protocol: 'venus' | 'aave-v3';
  account: Address;
  healthFactor: number;
  liquidationThreshold: number;
  ltv: number;
  collateral: { token: Address; amountUsd: number }[];
  debt: { token: Address; amountUsd: number }[];
  priceDropToLiquidationPct: number;       // the number users actually want
  oracleSources: string[];                 // Venus oracle-manipulation, 2026-03-15
  oracleStalenessSec: number;
  protocolPaused: boolean;                 // Venus paused 2025-09-02
};
```

### 3.5 Eligibility floors (DefiLlama's staleness eviction)

| Category | Floor | Rationale |
| --- | --- | --- |
| Rebalancing | pool TVL ≥ $10k | DefiLlama's own threshold |
| Grid | depth at 1% ≥ $25k | below this, slippage dominates the edge |
| Yield | TVL ≥ $10k **and** `apyUnboosted` computable | L6 — no unquotable rewards |
| Health | debt ≥ $500 | below this, gas exceeds the benefit |

Ineligible rows are retained with `ineligibleReason`, shown behind a toggle. **Never silently drop data** — silent drops are indistinguishable from bugs and destroy the Data Quality claim.

---

## 4. Blast Radius — schema and rendering

Read permissionlessly from the Altana Keystore. Mainnet `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a`, testnet per `BNB_TESTNET`.

```ts
type BlastRadius = {
  walletAddress: Address;
  sessionPublicKey: Hex;
  state: 'active' | 'expired' | 'revoked';
  expiry: number;

  callAllowlist: { to?: Address; signature?: string }[];   // AND semantics when both
  unbounded: boolean;            // ← callAllowlist.length === 0. See below.

  spendCaps: { token: Address | null; limit: bigint; period: 'hour' | 'day';
               decimals: number; consumedThisPeriod: bigint }[];

  resolvedContracts: { address: Address; label: string; verified: boolean }[];
  resolvedSelectors: { selector: Hex; signature: string; risk: 'read' | 'move' | 'approve' }[];

  worstCaseUsdPerDay: number | null;   // null when unbounded — say "unbounded", never guess
  verifyUrl: string;                   // Altana explorer — independent verification
};
```

**The `unbounded` flag is the single most differentiating computed field in the product.** Altana's docs state plainly: *"`permissions.calls` omitted = unrestricted… the session can call any contract within its spend cap."* Nobody else will read that line. Render it loudly:

```
⚠ UNBOUNDED AUTHORITY
  This agent's session has no contract allowlist. Within its spend cap it may
  call any contract on BNB Chain, including ones that did not exist when you
  authorised it.
  Worst case: the full spend cap, to any destination.       [ Revoke now ]
```

Agents with `unbounded === true` are **barred from `Verified`** and excluded from default discovery.

### 4.1 The decimals invariant

One helper, one place, exhaustively tested. A slip here is a **10¹²× error** because BNB stablecoins are 18 decimals where Ethereum's are 6.

```ts
// lib/spend/cap.ts — the ONLY place a spend cap is constructed.
export function spendCap(chainId: 56 | 97, token: Address | null,
                         humanAmount: string, period: 'hour' | 'day'): SpendPermission
// Tests MUST cover: USDT/USDC/BUSD on 56 and 97, native BNB, and a
// property test asserting round-trip human → wei → human for 18 and 6 decimals.
```

Session objects are persisted **byte-exact** with a bigint-safe serialiser. Altana: *"Sloppy JSON round-trips (bigints to numbers, key reordering) break the match."* Store the canonical JSON string, never a re-serialised object.

---

## 5. Ranking — the function that killed the GPT Store

**Tiered lexicographic, not a weighted score.** Weighted scores hide which input is doing the work and are therefore gameable. Popularity appears nowhere.

```
TIER 1  Verified + responding now
        └─ sort by counterfactual edge, LOWER confidence bound (not point estimate)
TIER 2  Listed + responding now + observations ≥ floor
        └─ sort by observation count (more evidence ranks higher)
TIER 3  Responding now, paper mode / below observation floor
        └─ sort by uptime 7d
─────────── discovery cutoff ───────────
EXCLUDED  Dormant · Shadowed · unbounded session
          Counted publicly on /live. Reachable by direct link. Never in discovery.
```

Sorting by the **lower confidence bound** of the edge, not the point estimate, structurally penalises short track records without a separate rule. An agent with n=8 and a spectacular mean loses to n=200 with a modest one. This is the anti-survivorship mechanism.

**Explicitly never a ranking input:** usage count, unique users, follower count, TVL/AUM, token market cap, GitHub stars, registration recency, cumulative ROI, closed-position win rate.

---

## 6. Metric registry

Every metric is a row here. If it is not in this registry with all fields populated, **it does not render.** This registry *is* `/methodology`.

```ts
type MetricDef = {
  id: string;
  display: string;
  formula: string;              // human-readable, exact
  denominator: string;          // what it is "per"
  window: string;               // explicit, always
  costTreatment: string;        // what is netted out
  observationFloor: number;     // below this → renders "insufficient observations"
  knownDefects: string[];       // L9 — mandatory, non-empty
  gameable: boolean;            // if true, requires a caveat chip in UI
  category: CategoryId | 'all';
};
```

### 6.1 Universal metrics

| id | display | formula | window | cost treatment | floor | known defects |
| --- | --- | --- | --- | --- | --- | --- |
| `uptime` | Uptime | successful probes ÷ total probes | 7d, 30d | n/a | 20 probes | probe vantage is single-region; agent may be up but wrong |
| `latency_p95` | Response time p95 | 95th pct of probe RTT | 7d | n/a | 20 probes | includes network path, not just agent compute |
| `net_pnl_mtm` | Net PnL | Σ realised **+ unrealised** MTM − gas − venue fees − agent fee | stated per view | all costs netted | category floor | oracle price at mark time; MTM on illiquid assets is indicative |
| `edge_vs_counterfactual` | Advantage | `net_pnl_mtm` − counterfactual PnL, same capital, same window | stated | both sides netted identically | category floor | counterfactual is a model, not an observation; assumes no market impact |
| `max_dd` | Max drawdown | peak-to-trough of MTM equity | since first action | net | category floor | **does not convey frequency, duration, or recovery — Binance's own caveat.** Always shown with `dd_duration` + `dd_recovered` |
| `dd_duration` | Drawdown length | days from peak to trough | since first action | — | — | — |
| `dd_recovered` | Recovered? | boolean | current | — | — | — |
| `obs_count` | Observations | count of completed agent actions | since first action | — | — | actions differ in size; not size-weighted |

### 6.2 Category counterfactuals

| Category | Counterfactual | Definition |
| --- | --- | --- |
| **Rebalancing** | **Unmanaged LP** *and* **HODL** | Same capital, same pool, initial range never touched (unmanaged); and 50/50 spot held (HODL). Both net of IL. Agent side additionally net of gas × rebalance count, CAKE harvest included if staked. |
| **Grid** | **HODL** | Same capital in the base asset over the identical window. Agent side MTM incl. open inventory (L8). |
| **Yield** | **Best passive single-venue** | Highest `apyUnboosted` reachable with one deposit and no further action, same asset, same window. Agent side net of migration gas. |
| **Health factor** | **No-agent outcome** | Replay the position against realised prices with no intervention; report whether liquidation would have occurred and the penalty avoided. |

### 6.3 Category observation floors and mandatory disclosures

| Category | Floor | Must disclose or refuse to display |
| --- | --- | --- |
| Rebalancing | 30 rebalance events | fee tier, tick spacing, realised IL, gas drag, rebalance count, staked-vs-unstaked, agent fee |
| Grid | **100 closed trades** (TradingView's floor) | range-exit behaviour, ruin probability, MTM incl. open inventory, max leverage, capacity vs depth |
| Yield | 10 migrations | `apyBase`/`apyReward` split, reward tradability + vesting, unboosted basis, migration gas |
| Health factor | 1 adverse regime observed | warning lead-time distribution, oracle sources + staleness, behaviour when protocol paused |

### 6.4 On-chain write-back encoding — do not pollute the registry

ERC-8004 feedback is `int128 value` + `uint8 valueDecimals` + `tag1`/`tag2`. **8004scan normalises this onto a 0–100 score** (observed `average_feedback_score`: 78.14 BSC, 80.99 global, 97.96 Monad) despite its OpenAPI spec documenting `minScore`/`maxScore` as 0–5. So our encoding choice determines whether our contribution reads as useful data or as a fake review.

| Tag | Encoding | Reads as | Verdict |
| --- | --- | --- | --- |
| `uptime` | `value = 9977, valueDecimals = 2` → 99.77 | 99.77 / 100 | ✅ **Write this.** Semantically aligned with a 0–100 score. |
| `successRate` | `value = 8900, valueDecimals = 2` → 89.00 | 89 / 100 | ✅ Write this. |
| `responseTime` | `value = 560, valueDecimals = 0` (ms) | **560 / 100** | ⚠️ Out of range — pollutes any naive 0–100 aggregator. Keep it **off-chain** in `feedbackURI` only. |
| `reachable` | `value = 1, valueDecimals = 0` | **1 / 100** | ❌ **Never write this.** A naive reader sees a 1/100 review — we would be defaming live agents. |
| `blocktimeFreshness` | `value = 4` (blocks) | 4 / 100 | ❌ Same problem. Off-chain only. |

**Rules:**
1. **Only percentage-shaped metrics go on-chain** (`uptime`, `successRate`), encoded with `valueDecimals = 2` so they land in 0–100.
2 Everything else — latency, failure streaks, probe-by-probe detail — goes in the off-chain JSON at `feedbackURI`, with its `keccak256` in `feedbackHash`. IPFS URIs may omit the hash per spec.
3. **Write only after 24h of consistent evidence.** On-chain feedback is permanent; the spec notes on-chain pointers cannot be deleted. A single-region probe blip must never become a permanent negative record.
4. **Suppress on correlated failure.** If the population-wide failure rate spikes in a window, the fault is ours, not the agents'. Do not write.
5. One stable, documented writer address, published on `/methodology`. Never rotated — its history is its credibility.
6. **Ask AltLayer directly** how they ingest `tag1`/`tag2` before the first mainnet write. They run hackathon office hours; this is a legitimate integration question and it makes us visible to a sponsor judge. Our data helps them only if it lands in the right field.

**Do not use the Validation Registry.** Ecosystem-wide it reports `total_validators: 0` and `total_validations: 0` — unused by anyone on any chain. Additionally, `validationRequest` MUST be called by the agent's owner or operator, so we could not initiate validation for third-party agents even if we wanted to.

---

### 6.5 Banned metrics — never rendered

| Banned | Why |
| --- | --- |
| Star rating | Cor ≈ 0 with usage (GPT Store, measured). Note 8004scan exposes `star_count` and `sortBy=stars` — we ingest it, we never display or rank on it. Unanchored stars specifically; hire-anchored comments are the L1 amendment, and they never become numbers. |
| "Win rate" as profitable-days | Binance's own formula is `Profit Days / days since first trade` — the most gameable displayed metric in the category |
| Closed-position-only PnL | Hides the unrealised book (L8) |
| Headline APY with boosts / locked / pre-TGE rewards | L6 |
| Cumulative ROI % | Path-dependent, inflated by small base and short windows |
| Follower / copier / user count | Reflects marketing and past luck; self-reinforcing |
| Backtest Sharpe without costs | Inflated by zero commission/slippage, margin = 0, lookahead |
| "Since inception" | Inception is chosen after the fact |

---

## 7. Data model (Postgres + Drizzle)

```
agents                 chainId, agentId, owner, agentURI, registrationJson, agentWallet,
                       agentWalletVerified, transferCount, lastUriUpdate, firstSeenAt,
                       trustState, jobName, categoryId, venues[]

agent_endpoints        agentId, kind('A2A'|'MCP'|'web'), url, domainVerified

probes                 agentId, endpointId, ts, ok, httpStatus, rttMs, schemaValid, error
                       ── hypertable-ish; partition by month. This table is the moat.

probe_rollups          agentId, window('7d'|'30d'), uptime, p50, p95, consecutiveFailures,
                       lastOkAt        ── what /live and the liveness strip read

reputation_writes      agentId, tag1, value, valueDecimals, txHash, ts
                       ── our ERC-8004 write-backs (reachable/uptime/responseTime/successRate)

reviewers              address, trusted, note
                       ── ERC-8004 getSummary REQUIRES a non-empty clientAddresses filter

verified_reviews       agentId, jobId (APEX escrow id = the anchor), clientAddress,
                       body, createdAt, disputed
                       ── L1 amendment: comments gated on a COMPLETED escrow job;
                         evidence only, never aggregated, never a sort key

opportunities          id, category, chainId, venue, ref, label, payload jsonb,
                       eligible, ineligibleReason, updatedAt

agent_actions          agentId, ts, txHash, opportunityId, calls jsonb, gasWei,
                       tokenDeltas jsonb, mode('live'|'paper')
                       ── the evidence base for every performance metric

sessions               walletAddress, sessionPublicKey, canonicalJson TEXT NOT NULL,
                       expiry, state, unbounded, callAllowlist jsonb, spendCaps jsonb,
                       grantTxHash, revokeTxHash
                       ── canonicalJson is byte-exact. NEVER re-serialise.

metric_values          agentId, metricId, window, value, obsCount, computedAt,
                       qualifiers jsonb   ── denominator/window/costs/n travel WITH the value
```

**Invariant enforced at the type level:** `metric_values` cannot be inserted without `qualifiers` populated, and the render layer accepts only `MetricValue`, never a bare number. L2 becomes unbreakable rather than remembered.

---

## 8. Workers (Bun)

| Worker | Cadence | Notes |
| --- | --- | --- |
| `ingest:8004scan` | 15 min | Paginate `/agents?chain=56`. Pro tier = ~2k requests for the full set. Free tier: category-filtered subset only. |
| `probe:liveness` | tiered | **Do not probe 200k.** Tier by last outcome: responded < 24h → every 15 min; responded ever → hourly; never responded → daily, then weekly. Concurrency-capped, per-host rate-limited, 5s timeout. |
| `writeback:erc8004` | 6 h | Batch `giveFeedback` with reserved tags `reachable`, `uptime`, `responseTime`, `successRate`. Makes us a reputation producer. |
| `index:pancakeswap` | 1 min | Pools, ticks (TickLens `0x9a4895…3796`), fees, MasterChefV3 staking state |
| `index:lending` | 1 min | Venus + Aave V3 markets, health factors, oracle staleness |
| `compute:metrics` | 5 min | Recompute `metric_values` + counterfactuals from `agent_actions` |
| `watch:sessions` | 30 s | Keystore reads; detect revocation/expiry; recompute `unbounded` |

---

## 9. Build order under this spec

Unchanged from `STRATEGY.md` §7, with the spike moved first:

| Days | Work |
| --- | --- |
| **0.5** | **Altana spike** — grant scoped session on testnet 97 → swap via SmartRouter → independent Keystore read → prove out-of-allowlist call **reverts** → revoke. Kills or confirms the thesis. |
| 1–3 | Schema + `ingest:8004scan` + `probe:liveness` + `index:pancakeswap` |
| 4–6 | `probe_rollups`, `/live`, the landing trust counter, `writeback:erc8004` |
| 7–9 | Metric registry, `metric_values` with enforced qualifiers, counterfactual engine, `/methodology` |
| 10–13 | Blast Radius reader, `unbounded` detection, `/authority`, hire flow, dry run |
| 14–16 | Seed reference agents from Altana's 10 skills — ≥2 per category, live on BSC, job-named |
| 17–18 | `<CategorySurface>` × 4 at equal depth, faceting, dead-end audit |
| 19–20 | `/compare` + Agent Advantage Report (3+ tasks both ways, ≥1 trading/stock/security) |
| 21–22 | Cold-read test by someone who has never seen it; mainnet tx if possible |

---

## 10. Open decisions

| Decision | Default I will take unless told otherwise |
| --- | --- |
| Probe vantage | Single region for the hackathon; disclose it as a known defect in `/methodology` (L9) |
| Paper-mode agents in discovery | Tier 3, clearly badged `PAPER`, never Tier 1 |
| Who is the ERC-8183 evaluator for seeded agents | An independent evaluator contract reading `agent_actions` outcomes — **never the agent, never us as the agent's operator** (grader ≠ solver) |
| Reviewer trust set v1 | Our own prober address + any address with ≥3 non-self feedbacks across ≥2 agents; published on `/methodology` |
| PancakeSwap version | V3 (+ SmartRouter). Infinity noted in roadmap. |
