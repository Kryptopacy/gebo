# GEBO — the demo script

Five minutes, live, in this order. Each stop has one punchline. If a step
fails live, say so out loud and show the honest failure state — that is the
product working, not the demo failing.

## 0. The opening (30s)

> "BNB Chain has 341,000 registered AI agents. The registry can tell you an
> agent exists. It cannot tell you whether it's alive, what it can do to
> your wallet, or whether hiring it beat doing the job yourself. Those three
> questions are the entire product."

Do not explain the architecture yet. Show the product.

## 1. The funnel — `/` (45s)

- Every number on screen carries its denominator and window. Point at one:
  "3,252 callable — out of 341,139 minted, 100,331 that declare an endpoint,
  measured by our prober, not by self-report."
- **Punchline:** "Every other directory repeats the registry's claim. This
  one reports whether anything answers."

## 2. Search — `/search?q=grid` (30s)

- 119+ matches over 257k materialized agents, ranked, sub-second.
- **Punchline:** "If this read ever fails, the page says *could not be
  measured*. It never says zero matches. A marketplace that fabricates a
  number when tired is just a worse version of the thing it replaces."

## 3. An agent card (60s)

- Pick any VERIFIED agent. Show: probe history with observation counts, the
  real unedited sample response from the agent's own endpoint, EXECUTE vs
  READ-ONLY skills.
- Scroll to reviews. **Punchline:** "'No verified reviews — reviews require
  a completed hire.' That empty state is the product's thesis. GPT Store
  ratings correlate with real usage at approximately zero, because anyone
  can rate anything. Here only the wallet that escrowed and completed a job
  can comment — and it's a comment, never a score."

## 4. The authority console — `/authority` (90s, the differentiator)

- "Question two: what can an agent do to this wallet?"
- Paste any BSC address (or the demo wallet
  `0x688Fe953e20225e0542ED11a11C708437e71d40e` on chain 97).
- Show: live Altana Keystore read — no permission needed, no vendor in the
  middle; the sessions with their spend caps and call targets; the global
  kill switch.
- Scroll to the bottom. **Punchline:** "Before you ever search, the page
  says what this check does NOT cover — Binance's Agentic Wallet keeps its
  state off chain where nobody can verify it. We publish the boundary of
  our own measurement on the page. A disclosure you have to trigger is not
  a disclosure."

## 5. The work itself — `/c/health` → any opportunity → `/o/[id]` (60s)

- Show the live Venus market state: rates, utilisation, collateral factor.
- Point at the oracle fields: "Oracle staleness: *unmeasured* — the
  Comptroller exposes no getter, so we say so, and we publish the thing we
  CAN measure: the oracle's BNB price versus the deepest pool's."
- Grid opportunity: "Ruin probability: *accumulating — 41 of 48 hourly
  observations*. It publishes when our own data can support it, not
  before."
- **Punchline:** "Every unmeasurable field on this site renders as
  unmeasured with a reason. That's not a limitation we apologize for — a
  number you can't verify is how every marketplace in this space has
  lied to its users."

## 6. Paper mode — `/paper` (45s)

- Run #1: 55 decisions recorded at 03:13 UTC today, each on its measured
  inputs, under a zero-spend read-only scope.
- **Punchline:** "An unproven agent's on-ramp: run your real decision loop
  with nothing at risk, get scored mechanically in public. The score is a
  fraction with counts and a rule. It can never become a rating, because
  ratings are the thing we measured as noise."

## 7. Close — the evidence (45s)

> "Everything here that can be on chain, is. The census reads the ERC-8004
> registry directly. Eleven reputation writes are on the mainnet Reputation
> Registry, running unattended every six hours. The hire flow goes through
> APEX — BNB Chain's own escrow — because the grader must never be the
> solver, and that includes us. Sessions, hiring, and x402 settlement all
> have transaction hashes you can check right now. The site is
> agent-consumable too — eight read-only MCP tools with caveats attached.
> The whole system runs on a free tier, and when the free tier throttled us
> this morning, the site showed a banner saying it could not measure —
> rather than a zero. That's the company we keep our data in."

## The 60-second version

Funnel (numbers qualified) → agent card (honest empty state) → authority
console (kill switch + published limits) → "on-chain evidence table in the
README, every link checkable."

## If they ask

- **"Why zero-budget jobs?"** Proving escrow custody would be proving BNB
  Chain's property. We route through APEX precisely so we are NOT the
  trusted party; demonstrating their custody quietly adopts responsibility
  for their contract. The state machine is identical; cost is a true zero.
- **"Why so few verified agents?"** 12 judged agents is the measured
  reality of the chain. Padding the category would fabricate supply — the
  exact failure this product exists to correct. The finding IS the product.
- **"What if your infra goes down?"** It did, this morning. The site
  rendered its could-not-measure states and recovered; the incident record
  is in the repo. A verification product that hides its own failures would
  be a contradiction.
- **"Why not mainnet execution?"** Indexing, probing and reputation run on
  mainnet — that's the moat. The demo rail (sessions, hire, x402) runs on
  testnet, which the track accepts, because the mainnet demo wallet is
  unfunded and we don't pretend otherwise.
