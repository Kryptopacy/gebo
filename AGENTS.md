# GEBO — working notes for whoever picks this up

GEBO is a verification-first agent registry for BNB Smart Chain. The premise:
discovery is not the hard part, verification is. ~294,000 ERC-8004 agents are
registered on BSC; someone deciding who to hire needs three answers the registry
cannot give — is this agent alive, what can it do to my wallet, and did hiring it
beat doing the job myself.

Strategy and rationale live in `docs/STRATEGY.md`. The buildable spec, including
the nine design laws, is `docs/PRODUCT_SPEC.md`. Read those for *why*. This file
is for *how to resume without re-deriving anything*.

## Resume protocol

Do this before planning anything. It takes under a minute and replaces guessing.

```
npm run readiness        # production gates, measured from the DB, not a checklist
npm run cron:status      # are the scheduled jobs alive, and did they succeed
npm run classify:drift   # is classification behind ingestion, or behind the rules
npm run stats            # the funnel figures the landing page serves
git log --oneline -12
```

`npm run readiness` is the source of truth for what is done. It exists because a
long session was lost and the written plan could not say which items had actually
landed. Never trust a hand-maintained status list in this repo, including any list
in this file — trust the script.

## Hard-won facts

Established by verification, not by documentation reading. Re-deriving these costs
hours.

| Thing | Value |
| --- | --- |
| ERC-8004 IdentityRegistry (56 / 97) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` / `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry (56 / 97) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` / `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Altana Keystore (56 / 97) | `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a` / `0x6b8361C29d05D498b1a12B54A37310f94171E94A` |
| PancakeSwap MasterChefV3 | `0x556B9306565093C7A00d48F1f28e2f0e0C59e59e` (verify before use) |

The Reputation Registry is **not** guessable from the Identity Registry. Probing
vanity prefixes found nothing; `0x8004b169…` has no code. Both addresses came from
the curated list at `github.com/erc-8004/erc-8004-contracts` and were then verified
on chain. Do not guess an `0x8004…` address.

**The transaction pooler silently drops VACUUM.** `VACUUM FULL` through the
Supavisor transaction pooler (port 6543) reports success and does nothing —
`last_vacuum` stays "never" and no space is reclaimed. Same failure shape as
pg_net's "succeeded means queued". Reclaim must run through the session
pooler (port 5432, `DATABASE_URL` with the port swapped) — a one-off script
is exactly what that connection is for. Found 2026-09-06 when the database
hit 442 MB of the 500 MB free tier: `probes_raw` had 18 days of rows because
its designed 48h rotation never existed in code (now `gebo-probes-rotate`,
migration 0021), and materialize stored ~1 KB of `registration_json` +
`token_uri` per agent that nothing reads (slimmed; `registry_tokens` is the
authoritative URI store). After surgery: 201 MB. Free-tier sizing is now a
live constraint — check `pg_database_size` before any per-row payload.

**Second surgery, 2026-09-07 evening (503 → 345 MB).** One day later the
quota was breached again. Attribution, measured: the backfill's ~69k new
`agents` rows (stored `capability_doc` tsvector alone is 36.7 MB across the
table), the `registry_tokens.token_uri` cache (67.3 MB — of which 67 MB sat
on rows already materialized into `agents`, where no code reads it:
materialize excludes them, resolve only touches unresolved rows, and the
chain re-read is authoritative anyway), 34 MB of never-scanned indexes
(`agents_agent_id_idx` — agent_id is derived from the pkey; uri_scheme;
the GIN-on-array `skills_idx` superseded by trgm), and `cron.job_run_details`
(pg_cron keeps history forever). Fixes in migration 0031 + the batched
one-off in `scripts/tmp-space-surgery.ts` (VACUUM FULL through the session
pooler, port 5432 — the transaction pooler swallows it, see above), plus
the hourly `gebo-maint` job that nulls materialized token_uris in 5k
batches and keeps 7-day cron history. The NEXT lever if the tier bites
again: swap the stored `capability_doc` generated column for an expression
index on `to_tsvector('english', name || ' ' || description)` — 37 MB and
~150 bytes/row of growth — but it needs a coordinated deploy (drop column
only after the expression-query code is live), so it was deliberately not
rushed. Steady-state growth after the surgery is ~3-4 MB/day at the current
mint rate: ~155 MB of headroom buys about a month, and the honest long-term
answers are the Pro tier or a slimmer per-row payload, not another round of
midnight surgery.

### The four marketplace items (2026-09-07 night)

The spec-vs-state gap analysis produced four engineering items; all four
landed in one session. What they are and the facts they established:

1. **`registry_counts` (0029)** - landing aggregates served from a one-row
   table refreshed by DIRECT pg_cron SQL every 5 min, because the direct
   aggregate measured 9.8s cold against the 9s render timeout. Served only
   while fresh (30 min = six missed runs); a direct-pooler connection stall
   still shows the honest banner, by design.
2. **Keystore session index (0034)** - third-party sessions indexed WITHOUT
   the Keystore's event ABI (the SDK ships none): logs are discovery only
   (topic1-shaped wallets), the truth per wallet comes from `readAuthority`
   itself. RPC facts, probed: **publicnode serves `eth_getLogs` only for the
   last ~10k blocks** ("archive requests require a personal token" beyond),
   and **the bnbchain dataseed free tier rejects `eth_getLogs` outright** at
   any range. So the index's history is bounded by the free RPC window and
   accumulates forward from the cron (10-min cadence, 5k-block windows);
   `/authority` states the index start wherever its rows are used.
   `source='chain-index'` rows carry NULL grant_tx_hash and expiry, which
   keeps them out of the demo-grants list and the readiness Altana gate -
   both mean GEBO's OWN grants.
3. **Opportunity fields (0035)** - grid `ruinProbabilityEstimate` is a
   disclosed log-normal model over OUR hourly tick snapshots
   (`pool_tick_snapshots`); V3 `observe()` reaches only ~4h on BSC pools
   (reverts OLD), so a one-shot vol read is dishonest precision. Publishes
   at >=48 hourly deltas spanning >=72h; "accumulating" until then. Health
   oracle fields: `oracleStalenessSec` and `protocolPaused` are PROBED
   UNREADABLE through the Venus Comptroller (getTokenConfig returns no
   usable feed set; getActionPaused/getMarketPauseFlags revert on the
   Diamond) - they render as unmeasured with reasons, plus the measurable
   proxy that IS readable: oracle-vs-pool divergence for BNB.
4. **Paper mode (0036, `/paper`)** - the reference health agent's real
   decision loop under a zero-spend read-only scope, recorded on measured
   inputs, scored mechanically on the next run. The score is a fraction
   with counts and its rule, never a rating (invariant 2 applies).
5. **`capability_doc` swap (0032/0033)** - the stored generated tsvector
   (36.7 MB) is replaced by a 13 MB expression index; the code now queries
   the expression. **0033 (drop the column) applies ONLY after the
   expression-code deploy is verified live on /search** - dropping early
   breaks the deployed search, the materialize-route lesson.
   **COMPLETED 2026-09-08 01:30 UTC**: deploy verified (119 matches, 407ms
   on /search?q=grid), then 0033 + VACUUM FULL via the session pooler:
   360 -> 309 MB. The coordinated sequence's worked example.

**The RPC depth limit is the reason the session index cannot backfill
further**: without a paid archive endpoint, history starts where the cron
started. If a BscScan API key or archive RPC is ever added, re-run
`scripts/backfill-sessions.ts --apply --depth <blocks>`.

### The sustainable free-tier fleet (2026-09-08, empirical)

The full cron fleet does NOT fit the Supabase free tier at 257k+ agents.
Measured twice in one day: restored at post-0037 cadences (census 30-min
gate, counts every 15), the database throttled again within ~3 hours
(select 1 at 6-8s, statement timeouts, cron responses mostly null). The
morning incident drained in ~40 min on a full stand-down; the answer is
not another cadence tune but a permanently thinner fleet:

| Job | Full fleet | Sustainable fleet |
| --- | --- | --- |
| resolve | every 1 min | every 5 |
| materialize | every 3 | every 5 |
| sync | every 5 | every 15 |
| probe | every 5 | every 10 |
| counts | every 15 | every 30 |
| classify, opportunities, sessions | 10 min each | OFF until Pro |

`scripts/tmp-thin-fleet.ts` applies this; `tmp-stand-down.ts` +
`tmp-restore-crons.ts` bracket an incident. Readiness on the thin fleet
reads 28/31: the session-index MISS and the classify backlog (queued=43)
are the disclosed cost, and every surface that renders their data states
its updated_at. If the tier ever carries more, restore the full values
from git history. The honest long-term answer remains Pro, which also
removes the ~3-4 MB/day storage ceiling calculation entirely.

**The fleet guard (0038) and the ops console (0039) automate the
incidents.** `gebo-guard` runs as direct SQL every 10 minutes, measures
in-database latency, sheds the bonus `gebo-opportunities` job after two
slow checks, panic-sheds materialize/probe/sync at 15s, and restores the
bonus job after an hour of health. `/admin` (ADMIN_PASSWORD-gated) gives
per-job run/pause/resume: pause stores the job's exact definition in
`admin_paused_jobs` before unscheduling, and the guard checks that table
before auto-restoring — **an admin pause always beats the automation**.
Both guard branches verified live; the original thresholds sat below the
DB's own healthy variance (13-858ms) and would have starved the restore —
found by deterministic test, not by assertion.

**Deploys are automatic, and a green local verify proves nothing on a
dirty tree** (found 2026-09-08): 60169f8 accidentally committed two
half-alive tmp scripts (staged, then deleted from disk - deleting does
not unstage), and every push after it failed the Vercel build while local
verify stayed green, because tsc checked the working tree, not the repo.
The live site silently kept an older build for hours. After any push,
verify the DEPLOYED content (probe a fingerprint like llms.txt), not just
the build log.

### The frozen product layer (found 2026-09-06)

Search, categories, cards, the prober and every agent-consumable surface read
`agents`/`agent_endpoints` — never `registry_tokens`. Until 2026-09-06 those
tables were only populated by hand-run loaders (load-db.ts, load-census.ts)
and had frozen at token #269686 while the census ran on to #336,715: every
agent registered after that — an entire Binance Agent OS mint wave — was
censused, resolved, and invisible. An agent launched through Binance Agent OS
did not appear in search; that report is how the gap was found.

Fixed by `/api/cron/materialize` (`gebo-materialize`, every 2 min, migration
0019) plus `scripts/backfill-agents.ts`, both over `src/lib/materialize.ts`:
newest-first, tokenURI re-read from chain (sync truncates the stored copy at
500 chars, and the pre-cron `sync-registry.ts` resolved 188k registrations
without storing any URI at all — the chain read heals both), DORMANT start
with SHADOWED only when every protocol endpoint is fatally linted, operators
upserted BEFORE agents (foreign key). `npm run readiness` gates the
census-vs-agents high-water lag so this failure is measured, not remembered.

**Deploys are AUTOMATIC on push to master** (corrected 2026-09-08: the user
confirmed it, and the evidence agrees - cc1079e's new routes were live
within ~20 minutes of push). The earlier record below is kept because its
lesson still stands: **"deployed" means the route answers, not that the
build finished.** The August materialize route 404'd for an hour after its
push - whether that was build-queue lag or a manual-deploy setting at the
time, the detection method is unchanged and still required after any
route-adding push: check `net._http_response` status codes, because a cron
job "succeeded" only means pg_net *queued* the request - a 404 or timeout
hides in the response table. DB-side changes (migrations, backfills) land
immediately; route code lands when Vercel finishes building.

### The Altana session shape

This cost the most time in the whole project. `NoSpendPermissions` was thrown
because the permission object was wrong, not because enforcement was broken:

```js
// correct, per Altana's own DEX guide
calls: [{ to: routerAddress }],                       // TARGET ONLY, no signature
spend: [{ limit, period: "day", token: stableAddress }] // the token that LEAVES the wallet
```

The call target and the spent token are different addresses. Do not add a
`signature` field; the guide does not use one. `src/lib/session-scope.ts` generates
this shape and `tests/session-scope.test.ts` pins it.

Enforcement is verified on chain (6/6 assertions, `npm run spike:altana`). The
non-obvious finding: **scope and spend are two independent dimensions.** A
target-only rule permits calling WBNB, yet moving WBNB out is still refused when
the spend cap covers native only. Do not describe them as one check.

What the Keystore **cannot** tell you: it exposes `getKeys`, `getPublicKey` and
`isValidKey` only. There is no getter for `metadata`, `validator` or `expiry` —
those are arguments to `registerKey`. So a third party's allowlist and spend caps
are **not** readable from the registry, and there is no reverse index from session
key to wallet. Both require indexing `registerKey`/`revokeKey` logs. The
`public.sessions` table was designed for exactly that and is still empty.

### Corrections to the record

- **ERC-8183 exists** (Draft, 2026-02-25), and its *reference implementation* drops
  the `expectedBudget` front-running guard from `fund()`. Do not build against that
  ABI. **BNB Chain's own deployment (APEX) does not have the flaw** and says so
  deliberately: it keeps `fund(uint256,uint256,bytes)` with `expectedBudget` and
  documents rejecting the reference form. An earlier note here also claimed
  `setBudget` is provider-only — wrong; the normative text is client **or** provider,
  and APEX implements that. Consequence: any SDK generated from the *reference*
  ABI fails against APEX with "function selector not found" on `fund` and
  `setProvider`.
- **x402 originated at Coinbase**, not Binance. "Binance x402" is their facilitator.
  Conflating them reads as shallow.
- BNB stablecoins are **18 decimals, not 6**. A decimals slip is a 10^12 spend-cap
  error. One helper constructs caps; it is property-tested across both.
- **We are on mainnet, not testnet — for INDEXING.** Every indexed figure is
  `chain_id = 56`, and `keystore.ts` defaults to 56. `CHAIN_ID=97` in `.env` is
  **dead config** — no code reads it; the two loaders hardcode `const CHAIN_ID = 56`.
  The hackathon requires agents "live on BSC" and Altana scores mainnet above
  testnet, so the mainnet run is worth the gas.
- **Altana DEMO activity is deliberately testnet (97)**: session grants, the
  spike, the ERC-8183 SDK hire, and the x402 sell all live on testnet because
  the mainnet demo wallet is unfunded and the Altana bounty accepts testnet.
  See "Altana demo stack" below before touching any of it.

### APEX (ERC-8183 escrow), verified on chain

Escrow is already deployed by BNB Chain, so **do not write or deploy a kernel**.
Its `EvaluatorRouter` is also the independent grader invariant 7 requires, which is
what lets us publish a track record for seeded agents without grading them
ourselves.

| | mainnet (56) | testnet (97) |
| --- | --- | --- |
| AgenticCommerce (proxy) | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | `0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE` |
| OptimisticPolicy | `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5` | `0xd6a4217588f6b1f5657a92a3e94e6422ad771cea` |
| paymentToken | `0xcE24439F2D9C6a2289F741120FE202248B666666` | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` |

- **`platformFeeBP = 0` on both chains** (read at block 117,662,206 / 126,805,485).
  Ceiling is `MAX_PLATFORM_FEE_BP = 1000` = 10%. Neither is paused.
- The fee is **read from storage in `complete()`, not locked at `fund()`**, and
  `setPlatformFee` is a plain `onlyOwner` call with no in-contract timelock. So the
  owner can change the rate on jobs **already in escrow**, bounded to 10%. Mainnet
  treasury is the burn address `0x…dEaD`, so today a raise would burn rather than
  pay — informative, but mutable. Re-read before quoting a cost.
- The token symbol is **`U`, 18 decimals**, on both chains. The repo README calls the
  testnet one "USDC on testnet"; it is not. `addresses.ts` is authoritative over the
  README.
- **Testnet has TWO OptimisticPolicy deployments, and only one works with the
  router.** `0x4f4678d4…` (24h dispute window, the Altana SDK registry's pick)
  and `0xd6a42175…` (15-min window, GEBO's pick) run identical bytecode, but
  `registerJob` reverts `PolicyNotWhitelisted` (selector `0xc94463e3`) for
  `0x4f4678d4…`. Every GEBO testnet hire binds `0xd6a42175…`, chosen so the
  Open → Funded → Submitted → Completed cycle finishes inside a demo.
  `scripts/hire-altana-sdk.ts` documents this: SDK path first, one-address
  fallback second.
- **Testnet $U comes from the public faucet** `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3`
  (`requestTokens()` pays 10 $U per address per 30 min). No testnet DEX pool
  exists for $U, so tBNB cannot be swapped into it. `scripts/claim-testnet-u.ts`
  claims via the relay so the smart account is msg.sender. Mainnet $U has no
  faucet but IS swap-acquirable on PancakeSwap V3 — measured pool depth in
  "Verified reviews".
- One job is **7 transactions** on the happy path — 5 client, 1 provider, 1
  permissionless `settle` — or 6 if the ERC-20 allowance already covers the budget.
  The evaluator never sends a transaction; `complete()` is an internal call from the
  router inside `settle`.
- Single fixed ERC-20 per deployment. **No native BNB**, no allowlist, no per-job
  token. Fee-on-transfer and rebasing tokens are out of scope and cause silent
  escrow drift. Zero-budget jobs are legal — a deliberate spec deviation.

### Altana demo stack (all testnet 97, all verified on-chain)

The demo wallet `0x688Fe953e20225e0542ED11a11C708437e71d40e` is an EOA
(EIP-7702-delegated to the Altana account implementation, so the EOA address
and the "smart account" address coincide). `DEMO_OWNER_PRIVATE_KEY` in `.env`
is its key. The pieces, and the order they depend on:

| Piece | Where | Proof |
| --- | --- | --- |
| $U faucet claim | `scripts/claim-testnet-u.ts` | 10 $U via relay tx |
| Scoped session grants | `scripts/grant-demo-sessions.ts` + cron `regrant` | 8 grant txs; regrant now targets testnet |
| ERC-8183 hire via Altana SDK | `scripts/hire-altana-sdk.ts` | job 788 FUNDED, tx `0xd48339a1…` |
| x402 sell endpoint | `app/api/agent/health/paid/route.ts` | 0.01 $U/call, both rails |
| x402 buyer test (session key pays) | `scripts/x402-buy-health.ts` | settlement tx `0xe110f574…` |

x402 facts that cost an evening: **eip3009 rejects session-key signatures**
("Invalid signature" from `transferWithAuthorization`) — Altana smart-account
buyers need the **permit2-exact** rail, and buyer provisioning is three steps
(`approveTokenForPermit2`, `approveSignatureChecker(PERMIT2_ADDRESS)`, then
`fetchWithX402`). The merchant's `payTo` must differ from the buyer or
settlement is a self-transfer; earnings go to `X402_PAY_TO` in `.env`
(`0x2Fb9E5CfebadbC77a9c1a42D96655F46d09D493d`), while the facilitator (gas
only) is the demo key.

### Verified reviews (the L1 amendment, 2026-08-31)

The GPT Store autopsy measures *unanchored* ratings: self-selected raters with
no proof of use. That r ≈ 0 finding does not condemn reviews — it locates where
review information actually lives: comments from wallets that provably completed
a job. ERC-8004 reaches the same conclusion from the attack side (`getSummary`
requires a non-empty `clientAddresses` filter). The anchor is GEBO's strength:

- **"Proven" means a COMPLETED escrow job, not any interaction.** Cost-of-attack
  is the whole game: an x402 call costs 0.01 $U, so interaction-gated reviews
  are Sybil-cheap; a completed APEX job costs ~7 transactions, gas, and a
  dispute window. Put the gate at the expensive door.
- **Comments, not numbers.** Free text keyed to the on-chain jobId, stored
  off-chain. The comment carries the net-new information — instruction-following,
  communication, did-it-do-what-the-brief-said — which neither probes (liveness)
  nor the APEX evaluator (mechanical completion) can measure. Stars, averages
  and review-derived ranking stay banned; L3 blocks the count variant
  independently (review count tracks hire volume, not quality).
- **Off-chain storage, on-chain anchor.** Invariant 6's logic applies to
  reviews: on-chain text is undeletable, and at our hire volumes one angry
  review is 33–100% of the visible signal.
- **Empty state is explicit:** "no verified reviews — reviews require a
  completed hire." Never a blank section, never a zero (invariant 9 generalizes
  to this).
- Reviews from jobs that went to dispute are marked or excluded.

**Built (2026-09-01):** migration `0017_verified_reviews.sql` (applied —
`scripts/tmp-apply-0017.ts`), the gate in `src/lib/reviews.ts` (signature →
job status Completed → client = signer → provider = agent, every check on
chain, every refusal legible), the write surface `POST /api/reviews` for
humans and agents alike, the read surface `GET /api/reviews` + MCP tool
`get_verified_reviews`, the form + panel on the agent card's Track record tab
(`app/a/[tokenId]/ReviewForm.tsx`), and `tests/reviews.test.ts`. The gate
refused every non-qualifying job in the e2e run (`scripts/tmp-review-e2e.ts`):
GEBO's own self-hired demo jobs (provider is not the agent), the Funded
not-yet-completed SDK hire, and a forged-attribution signature. The card
therefore shows the designed explicit empty state — that is the honest state
until a hire with the agent as provider completes, not a defect.

**$U acquisition must be integrated, not a scavenger hunt.** The $U-denominated
surfaces (x402 paid calls at 0.01 $U, non-zero job budgets) fail as UX if users
must hunt for the token. Acquisition is chain-specific, and both paths are now
verified:

- **Testnet (97):** the public faucet is the only source — no testnet DEX pool
  exists for $U, so tBNB cannot be swapped into it. The surface offers a
  one-click claim: a prepared `requestTokens()` call from the connected wallet
  (direct write for EOAs, the `scripts/claim-testnet-u.ts` relay pattern for
  Altana smart accounts so the account is msg.sender), disclosing the faucet
  limit — 10 $U per address per 30 min — and the resulting balance.
- **Mainnet (56):** no faucet, but $U IS swap-acquirable. Measured at block
  119,221,595 (`scripts/tmp-mainnet-u-check.ts`, factory controls validated):
  PancakeSwap V3 $U/USDT 0.01% pool `0xA0909f81785f87f3e79309F0E73A7d82208094E4`
  holds ~10.79M $U / ~10.23M USDT (deepest), V3 $U/WBNB 0.05%
  `0x882e23dbA77BFe0e514cF5BcDad7a58acEB01522` holds ~2.05M $U / ~2287 WBNB,
  V2 pair `0x108752b2A22C731edE3EdAC2205c63ae553E221a` ~81k $U; every other
  fee tier is dust or empty. The surface offers a swap route: v1 deep-links
  PancakeSwap with `outputCurrency` prefilled (zero custody, zero new contract
  surface of ours); an in-app V3 swap is the later upgrade. Take the WBNB
  constant from `src/lib/session-scope.ts`
  (`0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`) — a from-memory address
  produced silently-wrong "no pool" answers here, and only the WBNB/USDT
  controls caught it.

### Agent-consumable surfaces (the tool inventory)

Canonical list, because three surfaces serve agents and they drift if not
pinned in one place:

- **MCP server**, `POST /mcp` — **eight read-only tools** (defs in
  `src/lib/mcp.ts`, DB wiring in `app/mcp/route.ts`, list pinned by
  `tests/mcp-server.test.ts`): `search_agents`, `get_agent`,
  `list_categories`, `get_opportunities`, `get_registry_stats`,
  `get_track_record`, `get_verified_reviews`, `check_wallet_authority`
  (Altana Keystore session keys for a wallet; the not-covered list travels
  with the data). Every response carries its
  caveats (L2 applies to tool output too). Every tool declares an input AND
  an output schema — `outputSchema.required` is a non-empty tuple by type,
  because a schema that validates anything is documentation pretending to be
  a contract — `inputSchema` sets `additionalProperties: false` on every
  tool, and non-error results carry `structuredContent` alongside the
  text, generated from one payload so the two representations cannot drift.
- **Product assistant** (`app/api/assistant/route.ts` +
  `src/lib/assistant-tools.ts`) — the same read set through its own executors
  over the same data layer, plus product knowledge in its system prompt. It
  must never quote registry numbers from memory; a stale number spoken
  confidently is worse than no assistant. Read-only by the same law as MCP.
- **Browser WebMCP** (`src/lib/webmcp-bootstrap.ts` + `src/lib/webmcp.ts`,
  serialized into an inline `<head>` script from `layout.tsx`) — the full
  MCP read set (all eight tools, names and schemas derived from `MCP_TOOLS`,
  so this surface cannot drift from the server surface) plus two explicit
  navigation tools (`open_agent_card`, `open_hire_flow`). Answer tools
  return data and **never navigate**; only the `open_*` tools touch
  `window.location`, and their descriptions say so. Data tools execute by
  POSTing to this origin's own `/mcp`, so the two surfaces are literally the
  same reads. Registration happens at HTML **parse time** (scanners snapshot
  before React hydration) and is **sequential and awaited with a per-call
  timeout** — a fire-and-forget burst registers exactly one tool in any
  Chrome where the first call triggers the tools permission check, which is
  how four webmcp.com scans saw one imperative tool where nine shipped.
  Chrome strips `outputSchema` from `getTools()` (verified by probe), so the
  output contract travels as a "Returns:" line in each description; Chrome's
  declarative synthesis drops `pattern`/`maxLength` from reported schemas,
  which is why there are **zero declarative form tools** — a declarative
  twin of an imperative tool also collides on the name
  (`InvalidStateError: Duplicate tool name`). Inert without the WebMCP API.
  Never signs. `tests/webmcp.test.ts` pins the tool list, the constraints,
  the sequential-await shape, the zero-declarative sweep and the single
  `window.location` assignment; `scripts/webmcp-verify.mjs` is the runtime
  check in a flagged Chrome. The webmcp.com scorecard (graded B on
  2026-09-02, one tool visible, navigating mid-execute) is the failure that
  produced these rules — do not reintroduce a navigating answer tool to
  "improve UX"; add an `open_*` tool instead.
- **Write surfaces for agents** (the only ones): `POST /api/reviews`
  (wallet-signed, completed-escrow-gated — same gate as humans) and the x402
  paid read at `/api/agent/health/paid`. Everything that moves money or
  authority stays on human-visible pages by law.
- **Static index**: `public/llms.txt` lists all of the above for
  agent crawlers — keep it in sync when a tool or surface is added.

## Invariants that must not be broken

These encode failures already made and corrected. Breaking one silently undoes
real work.

1. **No bare numbers in the UI.** A metric renders with denominator, window, cost
   treatment and observation count, or not at all. `metric_values.qualifiers` is
   `NOT NULL` to make this structural rather than a matter of discipline.
2. **Never rank by popularity; never render an unanchored rating.** GPT Store
   data measured Cor(usage, rating) at −0.153 to +0.071 — ratings from
   self-selected, unverified raters are noise. There are no star ratings here.
   Amended 2026-08-31: verified reviews are allowed as comments gated on a
   completed APEX escrow job (see "Verified reviews") — evidence, never a
   score, never a sort key.
3. **Absence of evidence is never rendered as evidence of absence.** Any claim
   scoped to one data source must say so in the UI. `/authority` does this: it
   declares it reads one authority system (Altana Keystore) and renders an
   unconditional "What this check does not cover" section listing the routes it
   cannot see (unregistered sessions, Binance Agentic Wallet, plain approvals,
   the permission set). If a page ever prints an unscoped "none registered" again,
   that is the regression, and it is the highest-priority bug class.
4. **The judged four never grow.** `rebalancing`, `grid`, `yield`, `health` are
   fixed by the BNB rubric. Detected capabilities may only become *adjacent*
   categories.
5. **Never pad a category.** Classification was tightened four times and every
   correction reduced the count. 12 judged agents is the measured reality of this
   chain, not a defect. `tests/classify.test.ts` pins each correction.
6. **On-chain reputation writes need 24h of consistent evidence.** The spec notes
   on-chain pointers cannot be deleted, so a wrong negative permanently defames a
   live agent. `publishable()` in `src/lib/reputation.ts` is the gate; it also
   refuses to write when the whole population failed at once, because that is our
   network, not tens of thousands of agents.
7. **Grader is never solver.** Client-as-evaluator for user hires; an independent
   predicate contract for seeded agents whose track record we publish. We never
   evaluate agents we list while taking a fee on completion.
8. **Publish the defect.** The prober runs from one region and cannot distinguish
   "agent is down" from "unreachable from here". `/methodology` says so. A
   measurement whose limits are visible is evidence; one whose limits are hidden is
   marketing.
9. **A failed measurement must never render as zero.** This has now been found
   twice. `/live` printed "0 probes across 0 endpoints" while the database held
   43,456, because a timeout, a thrown query and a missing `DATABASE_URL` all
   returned an all-zero fallback the page rendered as fact. `/authority` headlined
   an unscoped "no session key has ever been registered". Any read that can fail
   returns an explicit `unavailable` flag with a reason, and the UI says it could
   not measure. Grep for `return empty`, `catch {}` and `?? 0` before trusting a
   figure on a page.
10. **Never aggregate a `jsonb` column without `jsonb_typeof(x) = 'object'`.**
   `coalesce(x, '{}'::jsonb)` substitutes for SQL `NULL` only and does nothing for a
   JSON scalar. 100 double-encoded rows raised "cannot call jsonb_each_text on a
   non-object", and because the reads sat in one `Promise.all`, that single
   rejection blanked every counter on the page. Independent reads get
   `Promise.allSettled`.
11. **`revoke ... from anon, authenticated` on a function does nothing.** Postgres
   grants `EXECUTE` to `PUBLIC` on creation and those roles inherit through it, so
   you must `revoke ... from public`. Migration 0005 carried the useless form for
   weeks, which left `gebo_secret` — a reader of `vault.decrypted_secrets` — callable
   over PostgREST at `/rest/v1/rpc/gebo_secret`, i.e. a route to the cron bearer
   token from outside the database. Read the ACL, do not trust the statement: an
   empty grantee before `=` (`=X/postgres`) **is** the `PUBLIC` grant, and a null
   ACL is the default, which also includes `PUBLIC`. `npm run readiness` now gates
   on this.

## Environment hazards

Windows + PowerShell 5.1. Each of these has already broken a build or corrupted a
file.

- **`Set-Content` writes Windows-1252**, not UTF-8. It corrupted a `.tsx` with a
  Windows-1252 em dash at byte 197 and the bundler rejected the file with "stream
  did not contain valid UTF-8" — after it had been committed broken. Use the `write`
  or `edit` tool for source files, never PowerShell redirection. Prefer ASCII-only
  source, with `\u` escapes where a Unicode character is genuinely wanted.
  A blanket "convert from CP1252" fix made it *worse* by mojibaking the valid parts.
- **No heredocs.** `git commit -F -` with `<<'MSG'` is a parse error. Write the
  message to a file under `C:\Users\DEV~1.ZOR\AppData\Local\Temp\kilo\` and use
  `git commit -F <file>`.
- **Backticks inside template literals.** A SQL comment written with backticks
  inside a `` sql`…` `` tagged template terminates the string. Use double quotes in
  SQL comments.
- **PowerShell regex fails on CRLF.** Use the `edit` tool instead of `-replace`.
- **DNS to the Supabase pooler flakes.** `getaddrinfo ENOTFOUND` is transient; retry
  before investigating.
- **`scripts/funnel.ts` hangs.** Do not run it. Use `npm run stats`.
- **`pg_net` cannot be moved with `SET SCHEMA`.** It is non-relocatable, so
  `alter extension pg_net set schema extensions` always fails. Migration 0012 drops
  and recreates it instead. That is only safe because the failure mode is
  verifiable: `net.http_get` **queues** and returns void, so a dead worker leaves
  every cron job reporting `succeeded` while no HTTP request is made — the pipeline
  stops and the dashboards look healthy. Always run `npm run verify:pgnet` after
  touching it; it queues a real request and waits for `net._http_response`.
  `gebo_run_cron` survives the drop only because it is `plpgsql`, whose bodies are
  not parsed at creation and so record no dependency. A SQL-language function
  referencing `net.http_get` would be dropped by the cascade.
- **`next build` while `next dev` is running corrupts `.next`.** They share the
  directory; the dev server then serves 500s for every route with
  `ENOENT routes-manifest.json`. Recovery is stop dev, `Remove-Item -Recurse -Force
  .next`, start dev. Deleting `.next` while a node process still holds a handle
  leaves a partial directory and the same error, so stop first and pause a second.
- **Recursive `Get-ChildItem` at the repo root walks `node_modules`** and will blow
  the output limit. Always scope the path.
- Resource contention is real — builds and scripts intermittently hang when many
  node processes are alive. A stale `.git/index.lock` should just be cleared.

## Concurrent agents

The second agent (Antigravity IDE's UI layer agent) was decommissioned on
2026-08-27 — Kilo is now the only agent working this worktree. Historically it
owned `app/globals.css`, `app/layout.tsx`, `app/page.tsx` and the visual layer
generally, and once swept uncommitted files (`src/lib/reputation.ts`,
`scripts/verify-reputation-registry.ts`) into a UI commit `5a0b46b` unverified.
That hazard is gone, but the rule it taught still stands: **commit your own work
promptly**, and check `git log --stat` for a commit whose message does not match
its contents.

## What is deliberately not built

Recorded so nobody "fixes" a decision.

- **No unanchored star ratings, ever.** Amended 2026-08-31: hire-anchored
  verified comments are allowed (see "Verified reviews"); stars, scores and
  review-derived ranking remain banned. See invariant 2.
- **No unfiltered ERC-8004 aggregation.** The spec requires a non-empty
  `clientAddresses` filter on `getSummary` because otherwise it is Sybil-farmable.
  Competitors rendering aggregate scores are violating the standard they cite.
- **Categories are not auto-created from term frequency.** Measured: frequency
  nominated `unibase` (an operator) on 17 verified texts, `swan` and `black` from
  memecoin titles, and the function word `not`. Four candidates, four noise. The
  detector surfaces candidates with evidence; a person promotes.
- **Multi-region probing** is the production answer to invariant 8 and is deferred.
- **PancakeSwap Infinity** is live and now their lead product; V3 is the target for
  now, with Infinity in the roadmap.
- **Escrow only mechanically-verifiable work.** A research agent's output quality is
  not on-chain checkable; meter that per call via x402 instead of pretending to
  escrow it.
- **Hire through APEX at ZERO budget, deliberately.** Proving that escrow custodies
  funds would be proving BNB Chain's property, not ours, and it conflicts with
  invariant 7: we route through APEX precisely so we are not the trusted party, and
  demonstrating their custody quietly adopts responsibility for their contract. The
  Agent Advantage Report asks for time, cost, output quality and attached outputs —
  value transfer appears nowhere, and `cost = 0` is a true figure rather than a
  missing one. A zero-budget job traverses the identical state machine
  (`Open → Funded → Submitted → Completed`); only the two `safeTransfer` calls are
  skipped, and `setBudget(jobId, 0)` is still required because `fund` reverts on
  `!jobHasBudget[jobId]`. Say so in the report rather than implying value moved.
  Cost: about **0.00023 BNB** for three jobs with headroom.

## Conventions

- Comments explain **why**, especially where a non-obvious choice encodes a bug
  already hit. Migrations carry the same standard.
- **No inline `gridTemplateColumns` on `.row`/`.rows-head`** (or `.spec`
  children). An inline grid beats every media query, so the table silently
  loses its mobile stacking and the rows region swipes sideways — this is
  exactly how `/compare` (232px), `/live` (34px) and `/methodology` (78px)
  shipped broken on phones while the class-based tables stacked fine. Column
  tracks live in `globals.css` as `.r-*` classes (`.r-runs`, `.r-uptime`, …);
  the one variable-column table (`.r-opps`) receives its tracks via an inline
  `--opp-grid` custom property, which the 900px breakpoint overrides
  wholesale. `npm run audit:mobile` (or `node scripts/mobile-audit.mjs
  [width] [height]`) audits every route (and the tab-hidden tables, by clicking each tab) at a phone viewport
  against the running server, measuring real overflow per element; run it
  after touching any table layout. `data-m="Label"` on a figure cell renders
  a small label above it inside the 900px breakpoint only, so stacked numbers
  stay legible without changing the desktop table.
- Every script prints what it measured, and says so when it cannot measure
  something rather than passing quietly.
- Never print a secret. `scripts/cron-fingerprint.ts` compares hashes because an
  earlier session leaked a live secret into a transcript.
- `npm run verify` = `tsc --noEmit && vitest run && next build`. Run it before
  claiming anything is done.
