# GEBO — Strategy & Architecture

**GEBO** is a verification-first agent registry for BNB Smart Chain, entered into the
hackathon whose prize is adoption as the official BNB Agent Studio marketplace. The two
names are distinct throughout this document: *GEBO* is this product, *BNB Agent Studio* is
the programme it is competing to serve.

The name is the Elder Futhark rune **ᚷ** (gebo) — gift, and specifically reciprocal
exchange. A marketplace is only that if both sides can see what they are getting, which is
the entire argument below.

Research-grounded. Every claim is traced to a primary source or labelled as inference.
Written 2026-08-18. **Submission deadline 2026-09-09 — 22 days.**

---

## 0. The competitive situation, stated plainly

The task looks like a directory brief. It is not. Read the rubric again:

| Criterion | Surface reading | What it actually demands |
| --- | --- | --- |
| **Functionality** | "nice UX" | *"land, find an agent by category, understand what it does, **activate it**"* — activation means granting an autonomous program authority over money. The activation flow **is** the session-key flow. |
| **Data Quality** | "show stats" | *"real-time, accurate data that **goes beyond basic counts**"* — an explicit instruction that counts are insufficient. This is an anti-GPT-Store clause. |
| **Agent Diversity** | "list a lot" | *"all four categories, **equally deep**"* — forces a category-generic engine, punishes a single-vertical demo. |

Source: https://www.bnbchain.org/en/hackathons/smart-money-era

**Consequence:** the winning build is not a prettier index. It is a **verification layer**. Discovery is the stated problem; verification is the unstated one, and it is what the criteria actually measure.

### The contrarian thesis — now measured, not inferred

> **The 257,832 agents on BSC are a liability, not an asset. The product's job is not to index them — it is to prove which handful are real, and make the rest legible as dead.**

I queried 8004scan's own API on 2026-08-18. The numbers are worse than the thesis assumed, and because they come from the sponsor's own data they are unimpeachable.

**BNB Smart Chain (chain 56):**

| Measure | Value | Implication |
| --- | --- | --- |
| Agents registered | **257,832** | up from "200,000+" in the July blog |
| New agents per day | **344** | registration is cheap and continuous |
| Declare a callable protocol (MCP or A2A) | **≤18,213 (~7.1%)** | MCP 4,676 · A2A 13,537. **~93% are not machine-addressable at all.** |
| Total feedbacks, all time | **11,705** | **0.045 feedbacks per agent** |
| Feedbacks today | **0** | nobody is reviewing anything |
| **Highest `total_score` on the entire chain** | **49.04 / 100** | the best agent on BSC scores under 50 |
| Feedbacks on that best agent | **3** | the #2–#5 ranked agents have **0** |

**Ecosystem-wide (all 26+ chains, 733,751 agents):**

| Measure | Value | Implication |
| --- | --- | --- |
| `total_validators` | **0** | — |
| `total_validations` | **0** | **The ERC-8004 Validation Registry has never been used by anyone, on any chain.** Do not build on it. |
| `protocol_distribution.unknown` | **674,595 of 733,751 (92%)** | the ecosystem is overwhelmingly unaddressable |
| Arc Testnet share of all feedback | **2,887,852 of 3,548,820 (81%)**, 6,212/day | one testnet generates four-fifths of all ERC-8004 "reputation". Any cross-chain average is meaningless. |

**The first agent returned by the default BSC listing** (newest-first, not cherry-picked) was registered 37 minutes before I queried:

```json
{ "name": "Blockgajjik",
  "description": "An EvoEvo AI Agent. Approach the question like a creative challenger…",
  "image_url": "https://evoevo.ai/images/avatar/01.jpg",
  "supported_protocols": ["Web"],          // no MCP, no A2A — not callable
  "star_count": 0, "total_score": 0, "total_feedbacks": 0,
  "health_score": null, "rank": null, "x402_supported": false,
  "created_at": "2026-08-18T13:39:41Z" }
```

Generic LLM boilerplate description, mass-minted avatar (`avatar/01.jpg`), no callable endpoint, no signal of any kind. This is the modal agent on BSC.

BNB Chain's own landscape report already conceded the shape of this:

> *"the identity base is large but application-level demand, the volume of real work agents pay for, still has to be proven."*
> — https://www.bnbchain.org/en/blog/bnb-chain-ai-agent-landscape-agents-tools-and-payments

**Strategic consequence:** a marketplace that surfaces 257,832 agents is surfacing ~93% noise. The addressable supply is at most ~18,213, and the *credible* supply is in the dozens. This is why the build is a verification layer and why the four seeded reference agents matter — real supply has to be created, not just indexed.

**ERC-8004 Identity Registry on BSC: `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432`** (vanity `0x8004`, from `contract_address` on every BSC agent). `agent_id` format is `{chainId}:{registry}:{tokenId}`.

Every competitor will wrap the 8004scan API, render 200k cards, add a star rating and a transaction count, and call it a marketplace. That build fails "beyond basic counts" by construction, and the empirical record says it fails in the market too.

---

## 1. Standards ledger — verified against primary sources

I initially doubted several of these. I was wrong on two. Corrected record:

| Standard | Status | Verified facts | Build implication |
| --- | --- | --- | --- |
| **ERC-8004** *Trustless Agents* | **Draft**, created 2025-08-13. Authors: MetaMask, Ethereum Foundation, Google, Coinbase | Three registries: **Identity** (ERC-721 + URIStorage; `agentId` = tokenId, `agentURI` → registration JSON), **Reputation** (`giveFeedback`, `int128 value` + `valueDecimals`, `tag1`/`tag2`, revocable, `appendResponse`), **Validation** (`validationRequest`/`validationResponse`, `response` 0–100). Requires EIP-155/712/721/1271. Payments explicitly **out of scope**. | Pin a commit hash; it is Draft and moving. **See §1.1 — the spec contains the single most exploitable detail in this whole project.** |
| **ERC-8183** *Agentic Commerce* | **Draft**, created **2026-02-25**. Authors: Davide Crapis (EF, also 8004) + three Virtuals Protocol people | Job escrow, 6 states: Open → Funded → Submitted → {Completed, Rejected, Expired}. **Evaluator alone** may complete/reject once Submitted. Single ERC-20. Optional `IACPHook` (`beforeAction`/`afterAction`). `claimRefund` deliberately **not** hookable. | **I was wrong to doubt this — it exists.** But see §1.2: the reference implementation contradicts its own spec in a way that is exploitable. |
| **EIP-7702** *Set Code for EOAs* | **Final**, Core | Delegation indicator `0xef0100 ‖ address`. Persistent, not per-tx. | Spec says: *"**There is no safe way to provide this interface**"* for apps prompting authorization, and *"it is **not possible to implement a system of permissions at this level**"* — apps "must use standardized extension / module systems built on top of the delegated code." **7702 alone is not session keys.** The brief's "one-click session activation via EIP-7702" is wrong as written. |
| **ERC-7710** *Smart Contract Delegation* | Draft | `redeemDelegations(bytes[] contexts, bytes32[] modes, bytes[] callDatas)`. Modes per ERC-7579. | The real delegation-redemption interface. |
| **ERC-7715** *Request Permissions* | Draft | `wallet_requestExecutionPermissions` / `wallet_revokeExecutionPermission` / `wallet_getGrantedExecutionPermissions`. Permission + `rules[]` (e.g. `expiry`). | The real permission-request RPC. Requires 4337 + 7710. |
| **x402** | Live, multi-SDK (TS/Py/Go/Java), v1→v2 migration exists | **Originated at Coinbase**, not Binance. HTTP 402 + facilitator + wallet roles. | **"Binance x402" is Binance's facilitator/integration, not the spec's origin.** Both statements are true; conflating them reads as shallow. On BSC: AEON runs a facilitator; Binance Pay integrated x402 with Trust Wallet AgentKit. |
| **Altana** | **Real. Hackathon sponsor.** altana.network | Self-custodial agent wallets. Sessions enforced **on-chain**: *"A session that tries to call a contract outside its allowlist, or spend beyond its cap, **reverts at validation time**. There is no off-chain trust assumption."* Keystore registry, free unlimited `isValidKey` reads, monotonic revocation. | **This is the load-bearing dependency.** See §1.3 for three gotchas that are also product features. |
| **8004scan** | **Real. AltLayer product.** 8004scan.io | Developer API: identity, capability, ownership, reputation, feedback, network. Hackathon Pro tier free: **500 req/min, 100k req/day**. | Ingest source, **not** the product. Everyone will use it. |
| **TermiX** | **Real. Sponsor.** app.termix.ai — "the marketplace where AI agents hire agents" | Open-source BSC MCP server: github.com/TermiX-official/bsc-mcp | **They will hire from your marketplace themselves.** Agents must actually work. |
| **BAP-578** | Real, BNB-native | Non-Fungible Agent standard — agents ownable/tradable/upgradable | Secondary. Note it exists; don't build on it. |

### 1.1 The exploitable detail in ERC-8004

The Reputation Registry spec includes a table of intended `tag1` values. Almost nobody will read it:

| `tag1` | Measures | Example | `value` | `valueDecimals` |
| --- | --- | --- | --- | --- |
| `reachable` | Endpoint reachable (binary) | true | 1 | 0 |
| `uptime` | Endpoint uptime % | 99.77% | 9977 | 2 |
| `successRate` | Success rate % | 89% | 89 | 0 |
| `responseTime` | Response time ms | 560ms | 560 | 0 |
| `blocktimeFreshness` | Avg block delay | 4 blocks | 4 | 0 |
| `ownerVerified` | Endpoint owned by agent owner | true | 1 | 0 |

**The spec was designed for exactly the liveness problem this marketplace has.** These tags are the schema for "is this agent alive." Implementing them makes us a reputation **producer**, not a consumer — see §4.1.

Second detail, equally important. `getSummary` is specified as:

```solidity
function getSummary(uint256 agentId, address[] calldata clientAddresses, string tag1, string tag2)
// clientAddresses MUST be provided (non-empty); results without filtering by
// clientAddresses are subject to Sybil/spam attacks.
```

**The spec itself forbids unfiltered reputation aggregation.** Any competitor who renders an aggregate score without a reviewer allowlist is violating the standard they're claiming to implement. We ship a reviewer-trust set and say so on the methodology page.

Also confirmed in the spec: `agentWallet` is a reserved metadata key requiring an EIP-712/ERC-1271 proof via `setAgentWallet`, and it is **automatically cleared on agent transfer**. A cleared `agentWallet` after a transfer is a strong "ownership changed, trust reset" signal to surface.

### 1.2 ERC-8183 reference implementation is unsafe — do not copy it

Diffing the published `AgenticCommerce.sol` against the spec prose in the same document:

| # | Spec says | Reference impl does | Severity |
| --- | --- | --- | --- |
| 1 | `fund(jobId, expectedBudget)` — *"SHALL revert if `job.budget != expectedBudget` (**front-running protection**)"* | `fund(uint256 jobId, bytes calldata optParams)` — **no `expectedBudget` parameter, no check** | **Critical.** Combined with #2, the provider can raise `setBudget` immediately before the client's `fund()` lands and drain the client's full ERC-20 allowance. |
| 2 | `setBudget` — *"Called by **client or provider**"* | `if (msg.sender != job.provider) revert Unauthorized();` — **provider only** | High. Inverts the negotiation model and enables #1. |
| 3 | `submit` — *"SHALL revert if job is not Funded"* | also permits `Open` when `budget == 0` | Medium — undocumented path. |
| 4 | `setProvider` listed as **hookable** | no hook calls in `setProvider` | Medium — a policy hook meant to gate provider reputation silently never fires. |
| 5 | `createJob` | calls `_afterHook` but never `_beforeHook` | Low. |
| 6 | — | `jobHasBudget` mapping written, never read | Low — dead state. |
| 7 | — | `initialize()` never calls `__UUPSUpgradeable_init()` | Low. |

**Decision: consume ERC-8183 through the Altana ERC-8183 SDK (`hireErc8183Agent`), which is the sponsor-supported path, rather than deploying the reference kernel.** If we ever deploy our own, `fund` takes `expectedBudget` and `setBudget` is client-or-provider. Documenting this diff is also a credibility artifact for judging.

### 1.3 Altana session gotchas that double as product features

From https://docs.altana.network/concepts/sessions:

1. **`permissions.calls` omitted = unrestricted.** *"If you don't pass `calls`, the session can call any contract within its spend cap."*
   → **This is a computable safety signal.** We can read any agent's session from Keystore and detect a missing call allowlist. That becomes the **Blast Radius** badge (§4.3). No competitor will surface this.
2. **Sessions must be byte-exact on execute** — `permissions + expiry + publicKey` must match the grant commitment. *"Sloppy JSON round-trips (bigints to numbers, key reordering) break the match."*
   → Persist the `Session` object verbatim. Use a bigint-safe serializer. This will be a real bug source; budget for it.
3. **Decimals differ per chain.** *"The same stablecoin uses 6 decimals on Ethereum and 18 on BNB Chain: 100 USDT/day on BNB is `100n * 10n ** 18n`."*
   → A decimals bug here is a **10¹²× spend-cap error**. Centralise cap construction in one audited helper with unit tests. This is the highest-severity footgun in the entire build.

Session shape:
```ts
type SessionPermissions = {
  calls?: readonly CallPermission[];   // { to } | { signature } | { to, signature } (AND)
  spend?: readonly SpendPermission[];  // { limit, period: "day"|"hour", token? }
};
// lifecycle: grantSession → execute → revokeSession (monotonic) | auto-expire
// verify: isValidKey — free, unlimited reads
```

---

## 2. Marketplace autopsy — what kills these, with numbers

### 2.1 GPT Store: the canonical death, and it is quantified

Primary: OpenAI announcement (10 Jan 2024); *GPT Store Mining and Analysis*, arXiv:2405.10210 (HUST, data 28 Mar 2024); *A First Look at GPT Apps*, arXiv:2402.15105.

| Fact | Number |
| --- | --- |
| GPTs created (OpenAI's claim) | **3,000,000+** |
| GPTs actually browsable across all 8 store categories | **~16,900** |
| **Discoverable share** | **≈0.56%** |
| Correlation(dialogue volume, **average rating**) | **−0.153 to +0.071** |
| Correlation(dialogue volume, **number of ratings**) | **0.330 to 0.706** |
| Staleness ratio, top-100 vs bottom-100 | **0.25–0.55** vs **0.83–0.96** |
| Sampled GPTs emitting policy-violating output despite "human and automated review" | **58.7%** (arXiv:2502.01436) |
| Creator retention | *"creator interest **plateaus within three months**"* |
| System prompts trivially extractable | *"**nearly 90%**… leading to considerable plagiarism and duplication"* |

**Three transferable conclusions:**

1. **Star ratings carry literally zero information about usage** (r ≈ 0). Do not ship a star rating. It is measured noise.
2. **Popularity ranking is self-reinforcing** (r = 0.33–0.71 with its own rating count), so ranking on usage manufactures a rich-get-richer loop uncorrelated with quality.
3. **Staleness is the strongest quality separator that was measured.** Freshness/liveness beats every other signal available. This is precisely the signal ERC-8004's `uptime`/`reachable` tags encode, and precisely the complaint at the top of the user-pain list.

Revenue share: the Jan 2024 page still reads *"In Q1 we will launch a GPT builder revenue program."* WIRED (2024-10-11) found it invite-only, US-only, with builders reporting *"doesn't provide any useful statistics"* and one 250-GPT builder earning nothing and cancelling his own subscription. **Builder-side promises that don't ship are a documented cause of supply collapse.**

### 2.2 Crypto agent marketplaces: launch revenue is not usage revenue

Virtuals Protocol, DefiLlama fees API (`api.llama.fi/summary/fees/virtuals-protocol`), fetched 2026-08-18:

| Metric | Value |
| --- | --- |
| Peak daily revenue | **$1,594,093** (2025-01-02) |
| Latest daily revenue | **$7,876** |
| **Decline** | **−99.51%** |
| Trailing 30d | $1,055,670 — *a month now earns two-thirds of one peak day* |

Sector-wide, "AI Agents" category vs ATH: ai16z **−99.99%** ($356k mcap, ATL 2026-07-24), aixbt −98.16%, Freysa −96.80%, Morpheus −98.64%, Virtuals −88.54%, ASI (ex-FET/AGIX/OCEAN) −96.46%. **ATH dates cluster 2025-01-01 → 2025-01-21** — the entire sector was one speculative window.

> **The lesson:** protocol revenue fell 99.5% *while the agents still existed*. That is only consistent with launch-fee revenue collapsing and service revenue never replacing it. **The agents were never being hired.**
>
> **Design rule:** if our headline metric can be moved by someone deploying more agents, it is the wrong metric. Headline on *activations by non-deployer wallets* and *retention past day 7*.

Olas Mech Marketplace is the closest existing analogue, and its demand-side entry point is:
```
mechx request --prompts "..." --priority-mech 0xb3c6…2101 --tools superforcaster --chain-config gnosis
```
**The discovery unit is a hex address plus a tool string.** No category, no comparison, no track record on the buy side. The "understand it → activate it" journey — judged criterion #1 — does not exist. That gap is a UI/verification gap, not a protocol gap, which is why it is winnable in 22 days.

### 2.3 What the working ones actually do

**TradingView** — the closest working analogue to a trading-agent marketplace, and effectively a copyable spec (support solutions 43000590599, 43000549951):

- **Three-state visibility, not accept/reject:** `Suggested` (in feeds + search) / `Unsuggested` (works, on author profile, **invisible to discovery**) / `Hidden` (invisible, **cannot be updated**). Severity-mapped. **Demote, don't delete.**
- **Cost realism is mandated, not verified:** realistic capital; commission **and slippage**; *"A margin of 0 is unrealistic in any circumstance, because it represents infinite leverage"*; *"the report should show **more than 100 trades**"*; resolve any caution warning before publishing.
- **Lookahead bias banned by name** (`barmerge.lookahead_on` on non-offset HTF expressions). Non-standard charts (Heikin Ashi, Renko, Kagi, P&F, range) banned for signal scripts because they *"produce very misleading results."*
- **Anti-overclaim with burden of proof on the publisher:** *"If you cannot substantiate a claim, **it does not belong in your publication**… it is impossible to substantiate claims about your script's future performance, because the future is inherently unknowable."*

> The insight: TradingView does not try to make every listing good. It makes the **discovery surface** good, and it moves trust from *"did this make money"* (unverifiable, gameable) to *"**were the assumptions honest**"* (checkable).

**DefiLlama** — the gold standard for DeFi data credibility (docs.llama.fi, `DefiLlama/yield-server`):

- Every metric is an **open-source adapter with a public PR path**. *"Data must be fetched from on-chain calls or from subgraphs."*
- A stated **conservatism doctrine**: *"Our goal is to display **minimum attainable yield**"* — omit pre-mined rewards, use **unboosted** APY, quote the **slashed** lower bound, exclude locked rewards, exclude pre-TGE points and non-transferable tokens.
- **Decomposed typed fields**, not one number: `apyBase`, `apyReward`, `rewardTokens[]`, `apyBaseBorrow`, `totalSupplyUsd`, `availableBorrowUsd`, `ltv`, `borrowable`, `isIntrinsicSource` (a dependency graph — Lido stETH APY as intrinsic yield of an Aave wstETH market).
- **Hard staleness eviction:** *"only displays pools with >10k TVL"*; stablecoin yields require *">1M TVL and on audited protocols."*
- **It has no cold-start problem because it doesn't list submissions — it indexes reality.** ← §5 is built on this.

**Hugging Face** — the mechanic is not "downloads," it is that **the definition of the download is published and auditable**: server-side counting over a named canonical file set *"to avoid double counting"*, per-library filter rules open-sourced in `model-libraries.ts`, and HF **publishes its own metric's known defects** (GGUF double-counts on repo clone). Plus Spaces: a runnable demo attached to the artifact. *A number whose construction you can inspect, plus a way to try it before committing.*

**Zapier** — best listing-unit design in existence. The unit is **the job, pre-wired**: `[job title] + [one-line job description] + [icons of apps involved]`. "Lead Enrichment Agent — researches new leads and enriches them with key details." Named after the user's job, never the technology (contrast the GPT Store having a category literally named after a *tool*, "DALL·E"). App icons are the trust signal — provenance-by-integration replaces reviews. And supply is generated **combinatorially from the integration graph**, not begged from strangers.

**Binance Copy Trading** — study it to *avoid* it. Binance's own documented formula:

```
Win Rate = Trader Profit Days / (Current Time − Time of First Trade) × 100%
```

**That is the fraction of profitable calendar days, not winning trades.** A leader up $1 on 90 days and down $50,000 on 10 days displays a 90% "win rate." Binance also documents that MDD *"doesn't consider the frequency of large losses, indicate how long it takes to recover, nor indicate whether the portfolio has already recovered."* Real user account, r/binance 2025-08-26: copied six traders with *"85–100% win rates, steady ascending charts"* — *"everyone lost 50% of my money."* Top reply names the mechanism: *"I can also get 100% win rate if I never close my losing trades."*

> **Closed-position-only accounting hides the entire unrealised book.** Our PnL must be mark-to-market including open positions, or we reproduce the most documented deception in the category.

One mechanic worth stealing from Binance: **Mock Trading** — paper-copy before real copy.

---

## 3. Real user voice — what people actually demand

All quotes retrieved from source. `[F]` = forum claim, `[V]` = verified reporting/academic.

**The thesis, stated by a user unprompted** — r/AI_Agents, ≈Apr 2026 `[F]`:
> *"How do you know what the agent is actually doing with your credentials? These are essentially closed-source programs with access to your stuff… the trust model seems completely unresolved. **You either give an agent full access or you don't use it.**"*

**The best listing-page spec found anywhere** — r/AI_Agents, ≈Jun 2026 `[F]`:
> *"people do not mistrust agent assets because the demo is bad; they mistrust them because **they cannot see what will happen after install**… what permissions, API keys, files, network calls, or tools it needs; a tiny before/after example with real inputs and outputs; **failure modes and rollback steps**; who the asset is for, and **who should not use it**… the listing page should look less like a SaaS landing page and more like a **compatibility/security sheet plus a worked example**."*

**On curation** — HN 2025-09-15 `[F]`:
> *"the gpt store… had zero quality control… millions of gpt 'apps', 99.99% of them complete garbage… **I would love to see a marketplace that rejects at least half of all app submissions.**"*

**On grader independence** — r/AI_Agents ≈Jul 2026 `[F]`: *"the core rule is: **the grader is never the solver**… the worker only gets paid if that independent check passes. **Fail → auto-refund + repost.**"*

**On grid bots specifically** — r/algotrading 2025-12-28 `[F]`:
> *"grid bots/martingale-style market making… **print money in sideways markets but eventually hit a 'black swan' or a strong trend that wipes out the account. The profit is predictable, but the tail risk is catastrophic.**"* — asks for **Probability of Default (ruin)** and **Life Expectancy** per grid.

**On LP accounting** — r/UniSwap `[F]`: LPs want ROI *"in absolute terms and **vs. HODLing**"* with the *"ROI **broken down between what is driven by price and what is driven by the fees**."*

**On ranking manipulation** — r/OpenAI ≈Jan 2024 `[F]`: *"is it as simple to game as just running up a lot of threads to simulate usage?"*

**On fake social proof** — HN 2026-04-20 `[F]`: *"They went 'all in' on ElizaOS because of the **star hype**. It was embarrassing."*

### Verified loss incidents — why policy must live outside the LLM

| Incident | Date | Loss | Mechanism |
| --- | --- | --- | --- |
| **3Commas** API key leak | Dec 2022 – Jan 2023 | aggregate unverified; ~100k keys reported | Platform **custodied exchange API keys**. Users reported unauthorised trades for weeks; platform admitted source later. FBI probe reported. |
| **Banana Gun** Telegram bot | 2024-09-19 | **563 ETH (~$2M)**; team absorbed **$3M** refund within 6 days | Messaging/identity layer was the blamed vector. |
| **Maestro / Unibot** | Oct 2023 | see CertiK writeup 2023-11-01 | Telegram trading bots exploited days apart. |
| **Freysa** prompt-injection challenge | 2024-11-29/30 | **~$47–50k** | Agent **talked into releasing its own treasury** by natural language. |
| **aixbt** agent | 2025-03-18 | **55.50 ETH (~$100k)** | Unauthorised **dashboard** access — the control plane, not the model. |
| **Venus (BSC)** user phishing | 2025-09-02 | **~$13.5M** | User signed a malicious delegation. Protocol paused. |
| **Venus (BSC)** oracle manipulation | 2026-03-15 | **$2.18M bad debt** | Price manipulation. Oracle risk on BSC is live, not theoretical. |

**Academic, decisive** — *Real AI Agents with Fake Memories*, arXiv:2503.16248 (Princeton et al., 2025), tested on **ElizaOS**:
> *"malicious injections into prompts or historical records can trigger **unauthorized asset transfers** and protocol violations"* · *"**AI models are significantly more vulnerable to memory injection compared to prompt injection**"* · *"**prompt-injection defenses and detectors only provide limited protection when stored context is corrupted**."*

> **The single most important engineering conclusion in this document:**
> **Authority must not be reachable by natural language at all.** Input filtering, system prompts, and guardrails are all defeated once memory is poisoned. The only durable boundary is a policy enforced *outside* the model — which is exactly what Altana's on-chain, revert-at-validation-time sessions provide. Our marketplace's core claim is therefore mechanically true, not aspirational.

### Ranked user demands (frequency × source independence)

1. **Bounded authority, not full access** — scoped permissions, spend caps, unilateral revoke
2. **Proof of performance from verified real work** — not self-report, not stars, not benchmarks
3. **A permission/blast-radius manifest on the listing** — including failure modes and "who should NOT use this"
4. **Curation with teeth**; "featured" must mean *we ran it*
5. **Working in-marketplace discovery** — facets, not an external search
6. **Paper-trade / simulate first; preview-then-sign**
7. **Kill switch + hard drawdown limit**
8. **Escrow with automatic refund on failure**, grader ≠ solver
9. **Transparency of actual logic and trades**; on-chain receipts
10. **Honest builder economics** — published split, global eligibility, real analytics

Top 5 things users say they **don't** trust: self-reported capability and vanity metrics · any agent holding credentials it doesn't need · backtests and performance claims · platform promises to builders · **the agent's own judgment under adversarial pressure**.

---

## 4. Eagle-eye: the universal agent requirement set, and who's missing it

Derived across every agent scope — DEX execution, LP management, lending health, yield routing, monitoring, research, A2A commerce. Nine requirements. Column "Gap" = whether existing marketplaces serve it.

| # | Universal requirement | Why every scope needs it | Existing coverage | Gap |
| --- | --- | --- | --- | --- |
| 1 | **Identity + capability schema** | Can't hire what you can't address | ERC-8004 + 8004scan | **Served** |
| 2 | **Liveness** — is the endpoint answering *now* | 80%+ of listings are stale; empirically the strongest quality separator | `active: true` is **self-declared** in the registration file; 8004scan shows registration, not health | **OPEN** |
| 3 | **Bounded authority, enforced outside the model** | Prompt/memory injection defeats all in-model defence (arXiv:2503.16248) | Altana provides the mechanism; **no marketplace renders it** | **OPEN** |
| 4 | **Counterfactual accounting** — vs the honest alternative | "Beat doing it yourself" is the only question that matters | Nobody. Copy-trading shows raw ROI; DefiLlama has no agent layer | **OPEN** |
| 5 | **Cost realism** — gas, slippage, IL, fees netted out | Rebalance churn silently eats the edge | TradingView mandates it for scripts; no agent marketplace does | **OPEN** |
| 6 | **Sybil-resistant reputation** | 72,800 registrations in 30 days | ERC-8004 *requires* reviewer filtering; consumers ignore it | **OPEN** |
| 7 | **Conditional settlement** — pay on verified success | "Paying upfront for probabilistic actions feels like a scam" | ERC-8183 exists (with impl bugs, §1.2) | Partly served |
| 8 | **Try-before-authorize** | #6 demand; Binance Mock Trading, HF Spaces both prove it converts | Absent from every agent marketplace | **OPEN** |
| 9 | **Revocation the user can see and trigger** | Every incident in §3 involved authority the user couldn't retract | Altana: one tx, immediate, monotonic | Mechanism exists, **unsurfaced** |

**Seven of nine are open.** That is the product.

### The four primitives to build

#### 4.1 Longitudinal liveness ledger — *corrected claim, 2026-08-18*

**Correction on the record.** I originally claimed liveness data would be entirely original because 8004scan's public list endpoint and its OpenAPI schema expose no health field. That was wrong. The **detail** endpoint (`/agents/{chainId}/{tokenId}`) returns far more than the spec documents, including:

```
health_status, health_score, health_checked_at,
is_endpoint_verified, endpoint_verified_at, endpoint_verified_domain,
endpoint_verification_error, endpoint_last_checked_at, is_active,
mcp_server, mcp_version, a2a_endpoint, a2a_version, agent_url, services,
quality_score, popularity_score, activity_score, wallet_score,
freshness_score, metadata_completeness_score, supported_trust_models,
agent_wallet, tags, categories, raw_metadata, parse_status, field_sources
```

**8004scan already probes endpoints and scores health.** "We check liveness" is therefore not a differentiator, and claiming it would have been caught by any judge from AltLayer.

**What is still missing, and is the actual differentiator:** their health signal is a **point-in-time snapshot**, not a time series. `health_checked_at` is a single timestamp and `health_score` in observed data is effectively binary — every one of the top five scored BSC A2A agents returns `health_score: 100`, including agents with zero feedbacks, while the freshly-minted farm agent returns `null`. There is no uptime percentage, no latency distribution, no failure-streak count, and no history.

So the precise claim is **longitudinal availability, published on-chain**:

| We produce | 8004scan has | Why it matters |
| --- | --- | --- |
| uptime % over 7d / 30d | single boolean-ish snapshot | "up right now" ≠ "reliable" |
| p50 / p95 latency distribution | — | slow-but-alive is a different product decision |
| consecutive-failure count, MTTR | — | distinguishes a blip from abandonment |
| availability history / sparkline | — | the GPT Store's strongest measured quality separator was staleness |
| **written back to ERC-8004 on-chain** | vendor database | portable, verifiable by anyone, not locked to one indexer |

The on-chain write-back is the durable part. Altana's own positioning makes the same argument about permissions — *"they all store the authorization state in places only their own stack can read"* — and it applies identically to liveness data. A number in 8004scan's Postgres is theirs; a number in the Reputation Registry is the ecosystem's.

**Implementation upside from the correction:** because `mcp_server`, `a2a_endpoint`, `agent_url` and `services` are available from the detail endpoint, we do **not** need to read `tokenURI` from the registry and resolve registration files ourselves to find probe targets. Cost: ~18,213 detail calls for the protocol-declaring BSC set — one-fifth of a single day's Pro budget, then deltas only. Chain reads stay in scope for independent verification of `agentURI` freshness, not as the primary path.

Write-back uses the ERC-8004 reserved tags `uptime`, `responseTime`, `successRate` — see the corrected value-encoding rules in `PRODUCT_SPEC.md` §6.4, which matter because 8004scan normalises feedback onto a 0–100 scale, not the 0–5 its OpenAPI spec claims.

#### 4.2 Honest-Metrics contract — TradingView + DefiLlama, transplanted

Never display a performance number without **(a) denominator, (b) window, (c) cost assumptions, (d) observation count**. Enforced per category:

| Category | Mandatory counterfactual | Mandatory disclosures | Refuse to display without |
| --- | --- | --- | --- |
| **Rebalancing** | vs **unmanaged LP** *and* vs **HODL** | realised IL, gas drag, rebalance count, agent fee, fee tier + tick spacing | ≥N rebalance events, full position log |
| **Grid Trading** | vs HODL over same window | **range-exit behaviour** (stop / re-range / halt), **ruin probability**, max drawdown **+ duration + recovery state** | ≥100 closed trades (TradingView floor), mark-to-market incl. open positions |
| **Yield Optimisation** | vs best passive single-venue | `apyBase` vs `apyReward` **split**, reward-token tradability + vesting, **unboosted lower bound** | tradable rewards only; no pre-TGE points, no locked emissions |
| **Health Factor** | vs no-agent liquidation outcome | **warning lead time distribution**, oracle sources + staleness, **behaviour when protocol is paused** | ≥1 adverse regime observed |

Ban the gameable set outright: star ratings (r≈0 to usage), "win rate" as profitable-days, closed-position-only PnL, headline APY with boosts, follower counts, cumulative ROI on a tiny base, backtest Sharpe without costs.

Adopt **three-state visibility**: `Verified` (discoverable + featured) / `Listed` (reachable by direct link, absent from discovery) / `Shadowed` (frozen, cannot be updated). Demote, don't delete.

Publish a **methodology page** stating every definition *and its known defects*, HF-style. This is cheap and disproportionately credible.

#### 4.3 Blast Radius badge — the differentiator nobody else can copy quickly

Read each agent's live session from the Altana Keystore (`isValidKey`, free reads) and render **enforced** authority as a first-class listing field:

```
BLAST RADIUS — what this agent can do to your wallet, enforced on-chain
  Contracts        PancakeSwap V3 SmartRouter · NonfungiblePositionManager   [2 allowed]
  Selectors        exactInputSingle · mint · decreaseLiquidity · collect     [4 allowed]
  Spend cap        250 USDT / day   ·   0.05 BNB / day
  Expires          2026-09-14 12:00 UTC        (in 6d 4h)
  Revoke           [ Revoke now ]  — one transaction, immediate, irreversible
  Worst case       ≤ 250 USDT/day to 2 known contracts. Cannot touch other tokens.
```

And critically, per §1.3(1) — **flag missing call allowlists**:

```
⚠ UNBOUNDED  This agent's session has no contract allowlist.
             It may call ANY contract within its spend cap.
```

Because Altana reverts at validation time, none of this is a claim. It is a fact any party can independently verify from chain state. **This is the mechanical answer to "you either give an agent full access or you don't use it."**

#### 4.4 Dry-Run before authorize

Simulate the agent's next action against current BSC state and show the diff **before** any session is granted. Then paper-mode: the agent runs its real decision loop with a zero-spend session, and its decisions are recorded and scored publicly. Paper-mode agents can graduate to `Verified` only after N real observations.

This is HF Spaces + Binance Mock Trading, in non-custodial form, and it satisfies "preview-then-sign."

---

## 5. Cold start: index reality, don't solicit listings

DefiLlama's structural advantage is that it never had a supply cold-start, because **listings are pools that already exist on-chain.** Copy that exactly.

**Step 1 — index the opportunity surface before any agent exists.** For each judged category, build a real on-chain surface:

| Category | Indexed surface (real BSC state, day one) |
| --- | --- |
| Rebalancing | PancakeSwap V3 pools: fee tier, tick spacing, realised volatility, fee APR, TVL, current-vs-optimal range |
| Grid Trading | Grid-viable pairs: realised vol bands, spread, depth, historical range-break frequency |
| Yield | Venus / Aave V3 / Lista markets: `apyBase` vs `apyReward`, reward tradability, caps, utilisation |
| Health Factor | Live lending positions: health factor distribution, liquidation distance, oracle source + staleness |

Thousands of legitimate rows, zero garbage, no submissions. **Agents attach to this surface** as "who can act on this opportunity, and what did they achieve on it."

**Step 2 — generate agent supply combinatorially, Zapier-style.** Altana ships **10 production skills** at skills.altana.network. They cover all four judged categories completely:

| Judged category | Altana skills that cover it |
| --- | --- |
| **Rebalancing** | PancakeSwap Liquidity |
| **Grid Trading** | PancakeSwap Trading + Token Radar |
| **Yield Optimisation** | Venus Lending · Aave V3 Lending · Lista Liquid Staking |
| **Health Factor** | Venus Lending · Aave V3 Lending · Wallet Tracker |

Remaining: Copy Trade, Four.meme Trading, x402 API Payments.

**The sponsor's own skill library is a complete cover of the sponsor's own judged categories.** This resolves the apparent contradiction between *"we're asking for the marketplace itself, not a portfolio of agents"* and *"agents surfaced on your marketplace must be live on BSC"* + TermiX hiring from it: ship the **marketplace**, seeded with a small reference cohort composed from Altana skills, each listed as a **named job** rather than an agent with a feature list.

**Step 3 — name listings after jobs, not technology.** Zapier's unit, not the GPT Store's:

> ✅ *"Keep my CAKE/USDT 0.05% position centred — re-ranges when 30% out of band, caps gas at 0.05 BNB/day"*
> ❌ *"AI-Powered Autonomous Liquidity Optimization Agent"*

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DISCOVERY UI — four category surfaces, faceted, job-named listings     │
│  Agent Card = compatibility/security sheet + worked example             │
│  land → find by category → understand → DRY RUN → activate (session)    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│  VERIFICATION CORE  ← the moat                                          │
│  ┌──────────────┬──────────────┬──────────────┬──────────────────────┐  │
│  │ Proof-of-Life│ Honest       │ Blast Radius │ Counterfactual       │  │
│  │ prober       │ Metrics      │ reader       │ engine               │  │
│  │ (§4.1)       │ gate (§4.2)  │ (§4.3)       │ (§4.2 table)         │  │
│  └──────┬───────┴──────┬───────┴──────┬───────┴──────────┬───────────┘  │
│         │ writes back  │ 3-state      │ isValidKey       │ vs HODL /    │
│         │ ERC-8004     │ visibility   │ (free reads)     │ unmanaged LP │
└─────────┼──────────────┼──────────────┼──────────────────┼──────────────┘
          │              │              │                  │
┌─────────▼──────────────▼──────────────▼──────────────────▼──────────────┐
│  DATA SPINE                                                             │
│  8004scan API (500rpm/100k-day)  ·  BSC indexer (opportunity surface)    │
│  Altana Keystore  ·  PancakeSwap V3  ·  Venus/Aave/Lista  ·  price oracles│
└─────────────────────────────────────────────────────────────────────────┘
          │                                                  │
┌─────────▼──────────────────────────┐  ┌──────────────────▼──────────────┐
│ EXECUTION — Altana sessions        │  │ SETTLEMENT — ERC-8183 via Altana │
│ on-chain policy, reverts at        │  │ SDK (hireErc8183Agent);          │
│ validation. calls[] + spend[] +    │  │ x402/b402 for per-call.          │
│ expiry. Revoke = 1 tx, monotonic.  │  │ Do NOT deploy the reference      │
│ NEVER hold a user key.             │  │ kernel — see §1.2.               │
└────────────────────────────────────┘  └──────────────────────────────────┘
```

**Non-negotiable invariants:**

- **I1** The platform never holds a key that can move user principal. (3Commas, aixbt)
- **I2** No fund-moving authority is reachable by natural language. Policy lives on-chain. (arXiv:2503.16248, Freysa)
- **I3** Every spend cap is constructed by one audited helper with per-chain decimals tests. (§1.3.3 — a 10¹² error class)
- **I4** No performance number renders without denominator + window + costs + observation count.
- **I5** Revoke is always reachable, never depends on agent cooperation, and is visible in the product.
- **I6** Grader ≠ solver. Settlement evaluators are independent of the agent being paid.
- **I7** Session objects persisted byte-exact, bigint-safe. (§1.3.2)

---

## 7. Build order — 22 days, re-anchored

You answered "production-intent." The deadline says 22 days. Resolution: **production-grade on the critical path, honestly-labelled scaffolding everywhere else.** Judging rewards this — the winner becomes a real product with a **Phase 2 that is explicitly `[REDACTED]`**, and the gap between shortlisting (Sep 23) and announcement (Nov 5) is long enough to be a durability test. Build something that survives inspection, not a demo.

| Days | Deliverable | Gate before moving on |
| --- | --- | --- |
| **1–3** | Data spine: 8004scan ingest (get Pro key **now** — forms.gle/jQevEPCAacBXaKG79), BSC indexer, opportunity surface for all 4 categories | 4 surfaces populated from live chain state |
| **4–6** | **Proof-of-Life prober** + write-back to ERC-8004 with reserved tags | Liveness data for the full BSC agent set; a defensible "% actually alive" number |
| **7–9** | Honest-Metrics gate + counterfactual engine + 3-state visibility | No number renders without its four qualifiers |
| **10–13** | Altana: `grantSession` / `execute` / `revokeSession`, Keystore reads, **Blast Radius badge**, unbounded-session flag | Live testnet tx through a session key; revoke visible in UI; decimals helper unit-tested |
| **14–16** | Seed reference cohort from the 10 Altana skills, ≥2 per category, live on BSC, named as jobs | All four categories equally deep; agents genuinely execute |
| **17–18** | Dry-Run + paper mode | Simulated diff shown pre-authorization |
| **19–20** | **Agent Advantage Report** — 3+ real tasks both ways, time/cost/quality, outputs attached, ≥1 from trading/stock/security | TermiX's 30% criterion is evidence-backed |
| **21–22** | Journey polish (zero-knowledge user completes land→activate with no dead end), methodology page, mainnet tx if possible | Cold-read test by someone who has never seen it |

**Sequencing rationale:** Proof-of-Life ships before UI polish because it is the only thing that produces original data, and Data Quality is the criterion competitors will most obviously fail. Altana lands mid-build because "activate it" is the Functionality criterion *and* the Altana track — one implementation, two scores. The Agent Advantage Report is scheduled, not improvised, because it needs real task history to exist first.

**Parallel wins:** one comparison engine serves main-track Data Quality + TermiX's "proven advantage" (30%) + PancakeSwap's "real benefit to traders/LPs." One session implementation serves main-track Functionality + the entire Altana track. Entering partner tracks doesn't affect the main score, and one build can win both.

---

## 8. Verified integration facts (blockers closed 2026-08-18)

### 8.1 Altana — CertiK audited 15 Jul 2026 (Skynet: skynet.certik.com/projects/altana)

SDK `@altananetwork/sdk` **0.7.1** · MCP `@altananetwork/mcp` **0.7.1** · built on **Porto** (MIT, porto.sh) extended for Keystore compatibility.

| Network | Chain ID | KeyStore | KeyStoreController |
| --- | --- | --- | --- |
| **BNB Smart Chain** (default) | 56 | `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a` | `0x0834Ee2C9BdC3E3efF0a2dC34393D4B0e546A555` |
| Ethereum | 1 | `0xb70fDa90C1d576Ba8399946a0c10ECD9d9Ea923b` | `0x30a188Eecf14F4142B0d828ce838C9E1134e7FaA` |
| Base (cache only, no relay) | 8453 | `0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a` (KeyStoreCache) | — |

- Relay: `https://relay.altana.network` · Explorer: explorer.altana.network (mainnet), testnet.altana.network
- **BNB Testnet (97) is full-stack** — keystore, account contracts *and* relay deployed. `BNB_TESTNET` config ships in the SDK. End-to-end testnet is therefore a non-issue.
- **Use case 4, "Verify an agent's authority from anywhere," is officially supported and permissionless:** *"Anyone can run this. It is a plain read against the public Keystore, so it needs no admin key, no session, and nothing from Altana."* → **§4.3 Blast Radius is a first-class supported operation, not a hack.**
- **Use case 2 is literally PancakeSwap on BNB.** Our rebalancing/grid path is their headline example.
- Altana's own positioning confirms the moat argument: *"Most ['agentic wallet' products] store the authorization state in places only their own stack can read."*
- **Gotchas beyond §1.3:** MCP requires **Bun 1.1+** (`bunx`; `npx` fails with a TS syntax error). ERC-1271 off-chain signatures need `approveSignatureChecker` **once per session, per rail**. Permit2 x402 rail needs `approveTokenForPermit2` once. ERC-8183 selling settles in **$U**; buying is x402.

### 8.2 PancakeSwap — official developer portal, BSC

| Contract | BSC Mainnet | BSC Testnet |
| --- | --- | --- |
| **SmartRouter** (routes v3 + v2 + stable) | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `0x9a489505a00cE272eAa5e07Dba6491314CaE3796` |
| SwapRouter (plain v3) | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` |
| NonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `0x427bF5b37357632377eCbEC9de3626C71A5396c1` |
| PancakeV3Factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | same |
| QuoterV2 | `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997` | `0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2` |
| TickLens | `0x9a489505a00cE272eAa5e07Dba6491314CaE3796` | `0xac1cE734566f390A94b00eb9bf561c2625BF44ea` |
| **MasterChefV3** (farm staking wrapper) | `0x556B9306565093C855AEA9AE92A594704c2Cd59e` | `0x4c650FB471fe4e0f476fD3437C3411B1122c4e3B` |

- **MasterChefV3 confirmed — the LP-NFT custody risk is real.** A farming position's NFT is held by MasterChefV3, not the user. Rebalancing a staked position requires withdraw → modify → re-stake, and CAKE harvest must be accounted for in the counterfactual. Detect staked vs unstaked before quoting any rebalance.
- **Target the SmartRouter** for swaps (aggregates v3/v2/StableSwap), NonfungiblePositionManager for LP lifecycle.
- **PancakeSwap Infinity is live and is now the lead product** (Vault accounting layer, PoolManager AMM layer, Concentrated Liquidity + Liquidity Book, Hooks, Farms). Decision: **build on V3 for the 22 days** (mature, MasterChefV3 farms, stable ABIs), note Infinity in the roadmap. Revisit only if the seeded agents need hooks.

### 8.3 8004scan API — the moat holds

Public REST, OpenAPI 3.0 at `https://8004scan.io/api/v1/public/docs/openapi.json`. CORS enabled. **No key needed** for anonymous.

| Tier | Req/min | Daily |
| --- | --- | --- |
| Anonymous | 10 | 100 |
| Free API | 30 | 1,000 |
| Basic | 100 | 10,000 |
| **Pro** (hackathon grant) | **500** | **100,000** |

**Auth is `X-API-Key` header.** `limit` max **100**, default 20 → full BSC enumeration is **~2,580 requests**. Response envelope `{success, data, meta:{version,timestamp,requestId,pagination:{page,limit,total,hasMore}}}`. `X-RateLimit-Reset` is **ISO 8601**, not seconds — implement backoff accordingly.

`/agents` filters: `chainId`, `ownerAddress`, `search`, `protocol` (`MCP|A2A|OASF|Web|Email`), `isTestnet`, `sortBy` (`created_at|stars|name|token_id|total_score`), `sortOrder`.

**The OpenAPI spec understates the API in two ways that matter.** Verify against live responses, not the schema:

1. **The list and detail endpoints return different shapes.** List gives ~30 fields; detail gives ~70, including all endpoint URLs (`mcp_server`, `a2a_endpoint`, `agent_url`, `services`) and health data (`health_status`, `health_score`, `health_checked_at`, `endpoint_last_checked_at`, `is_endpoint_verified`). Probe targets come from detail, not list.
2. **Feedback scores are 0–100, not 0–5.** The spec documents `minScore`/`maxScore` as 0–5, but observed `average_feedback_score` values are 78.14 (BSC), 80.99 (global), 97.96 (Monad). This directly determines how we encode on-chain write-backs — see `PRODUCT_SPEC.md` §6.4.

**Moat claim corrected:** 8004scan already does endpoint health checking, so "we check liveness" is not differentiating. Their signal is a point-in-time snapshot with no history. Our differentiator is the **longitudinal record** (uptime %, latency distribution, failure streaks, MTTR) **published on-chain**. Full correction in §4.1.

**Also confirmed:** `total_validators: 0` and `total_validations: 0` ecosystem-wide. The ERC-8004 Validation Registry is unused by everyone. Do not build on it.

Canonical contracts: **github.com/erc-8004/erc-8004-contracts** (prefer over the draft's inline code). BSC Identity Registry: `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432`. Also `best-practices.8004scan.io` and `8004.org`.

### 8.4 Still open

| Item | Action |
| --- | --- |
| 8004scan **Pro key** — needs a human to submit forms.gle/jQevEPCAacBXaKG79 after creating a key at 8004scan.io/developers | **You. Day 1.** Free tier unblocks dev meanwhile. |
| BNB testnet funds | testnet.bnbchain.org/faucet-smart |
| Verified share of the 200k with *any* non-self feedback | Compute from ingest — this is the headline number |
| Phase 2 criteria | `[REDACTED]`. Monitor hackathon page + BNB Discord |
| Read `docs.altana.network/llms-full.txt` + install the Altana Claude skill | Do before writing session code |

## 9. Things I could not verify — do not assert these

- OpenAI GPT-builder revenue-share payout criteria/totals (announcement still reads "In Q1 we will launch")
- Olas Mech request volumes; Pearl active-agent counts
- Virtuals: agents launched / live / actually transacting on ACP (their own metrics page contains no numbers)
- Fetch.ai Agentverse counts; DeltaV status
- 3Commas aggregate user losses (commonly cited ~$22M — unconfirmed)
- Real user voice on auto-rebalancing vault underperformance (Arrakis/Gamma/Steer/Beefy) — **none found; §4.2's rebalancing counterfactual is reasoned, not user-validated**
- First-person Aave/Venus liquidation post-mortems — none retrieved
- Any named agent app store that shut down outright in 2025–26 (only dissolutions verified: ai16z→ElizaOS at −99.99%; AGIX+OCEAN absorbed into ASI at −96.46%)
