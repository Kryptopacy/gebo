# Agent Advantage Report — GEBO

> **Generated file.** Regenerate with `npm run report:advantage`; do not edit by hand.
> A hand-maintained version of this document is exactly the fault this project
> exists to correct. Source of truth: the same task-run ledger that serves
> <https://gebo-bsc.vercel.app/compare>. Generated 2026-08-31 16:06:30 UTC. This file is a
> snapshot taken for submission; the live page is the current view.

## What this report is

TermiX asks one question: does hiring an agent on your marketplace beat doing
the job yourself, and can you prove it? Each task below was run **both ways** —
once by an agent, once without one — with both arms timed and costed. The
manual arm runs the same computation an agent would (reads and arithmetic
only), so it understates rather than overstates agent advantage, and its
output is the ground truth the agent's reply is graded against: a reply that
does not carry the number the chain computes is graded PARTIAL or FAILED, not
generously.

Failures stay in the totals at full weight. Canned-sounding replies are
recorded as PARTIAL and honest declines as FAILED. A negative result is
published as one.

## The tasks

| Task | TermiX weighting tier | What was asked |
| --- | --- | --- |
| Venus health factor | security | The lending health factor of a live position, and whether it is at risk of liquidation — checkable to the cent against Venus's own getAccountLiquidity |
| Best Venus supply APR | yield | Which major Venus market currently pays suppliers the highest APR — checkable against supplyRatePerBlock on every market |
| PancakeSwap V3 pool tick | trading-infrastructure | The exact state of the deepest WBNB/USDT pool — checkable against slot0, and the number a grid or rebalancing agent must know before placing anything |

TermiX weights trading, equities and security highest; all three tasks sit in
that tier. Note on labelling: the "tier" above is the task's domain, while the
per-run rows further down carry each agent's marketplace category (grid,
health, rebalancing, ...), which can differ — a rebalancing agent asked a
trading-infrastructure question is recorded under its own category.

## Requirement check (encoded, not eyeballed)

All clauses met as of generation: 26 runs (>= 3), high-stakes category covered (grid, health, rebalancing), every run timed on both arms (26/26), outputs attached, 26 runs with verified evidence.

## Aggregates

- **Runs:** 26 — 1 succeeded, 14 partial, 11 failed. 26 with verified evidence.
- **Time saved: 33.9s (28.9%)** across 26 runs timed on both arms — 1m 24s with an agent against 2m 58s without, failures included at full weight, and 1 of 26 returned the answer that was asked for.
- **Cost: 0 USD** across 16 priced runs — nothing was charged on either arm. Both arms read public chain state; the marginal cash cost of a task is zero on each side.
- **Successful runs only:** −12.3% — shown for contrast with the figure above, never instead of it.


## Every run, including the ones that went badly

| Date | Task | Agent | Outcome | With agent | By hand | Saved |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-31 | For the PancakeSwap V3 pool WBNB/USDT 0.01%: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? | GridRunner #259575 | partial | 1.2s · 0.0000 USD | 614 ms · 0.0000 USD | −557 ms |
| 2026-08-31 | For the PancakeSwap V3 pool WBNB/USDT 0.01%: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? | BNB LP Range Rebalancer #265375 | partial | 2.6s · 0.0000 USD | 614 ms · 0.0000 USD | −2.0s |
| 2026-08-31 | For the PancakeSwap V3 pool WBNB/USDT 0.01%: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? | BNB Grid Trader (test) #269233 | partial | 2.6s · 0.0000 USD | 614 ms · 0.0000 USD | −2.0s |
| 2026-08-31 | For the PancakeSwap V3 pool WBNB/USDT 0.01%: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? | HealthGuard #259573 | failed | 616 ms · 0.0000 USD | 614 ms · 0.0000 USD | −2 ms |
| 2026-08-26 | For the PancakeSwap V3 pool undefined: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? | GridRunner #259575 | partial | 877 ms · 0.0000 USD | 486 ms · 0.0000 USD | −391 ms |
| 2026-08-26 | For the PancakeSwap V3 pool undefined: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? | BNB LP Range Rebalancer #265375 | partial | 1.9s · 0.0000 USD | 486 ms · 0.0000 USD | −1.4s |
| 2026-08-26 | For the PancakeSwap V3 pool undefined: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? | BNB Grid Trader (test) #269233 | partial | 5.6s · 0.0000 USD | 486 ms · 0.0000 USD | −5.2s |
| 2026-08-26 | For the PancakeSwap V3 pool undefined: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? | HealthGuard #259573 | failed | 445 ms · 0.0000 USD | 486 ms · 0.0000 USD | 41 ms (not usable) |
| 2026-08-26 | Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent? | GridRunner #259575 | partial | 966 ms · 0.0000 USD | 3.0s · 0.0000 USD | 2.0s (not usable) |
| 2026-08-26 | Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent? | BNB LP Range Rebalancer #265375 | partial | 2.5s · 0.0000 USD | 3.0s · 0.0000 USD | 541 ms (not usable) |
| 2026-08-26 | Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent? | BNB Grid Trader (test) #269233 | partial | 2.5s · 0.0000 USD | 3.0s · 0.0000 USD | 516 ms (not usable) |
| 2026-08-26 | Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent? | HealthGuard #259573 | failed | 629 ms · 0.0000 USD | 3.0s · 0.0000 USD | 2.4s (not usable) |
| 2026-08-26 | 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 supplies collateral on Venus but carries no debt right now, so there is no ratio. How much borrowing power, in USD, does that address have? Report the figure. | GridRunner #259575 | partial | 1.8s · 0.0000 USD | 2.1s · 0.0000 USD | 382 ms (not usable) |
| 2026-08-26 | 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 supplies collateral on Venus but carries no debt right now, so there is no ratio. How much borrowing power, in USD, does that address have? Report the figure. | BNB Grid Trader (test) #269233 | partial | 3.3s · 0.0000 USD | 2.1s · 0.0000 USD | −1.2s |
| 2026-08-24 | What is the Venus lending health factor for 0x913bf7DAf9C48AcA2671603C515026A9902225a5 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | Professor #207685 | failed | 12.1s | 17.5s | 5.4s (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0x913bf7DAf9C48AcA2671603C515026A9902225a5 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | RangeKeeper #259574 | failed | 9.8s | 17.5s | 7.7s (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0x913bf7DAf9C48AcA2671603C515026A9902225a5 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | BNB LP Range Rebalancer #265375 | partial | 11.6s | 17.5s | 5.9s (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0x913bf7DAf9C48AcA2671603C515026A9902225a5 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | HealthGuard #259573 | failed | 5.5s | 17.5s | 12.0s (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | Professor #207685 | failed | 2.2s | 3.2s | 976 ms (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | RangeKeeper #259574 | failed | 1.4s | 3.2s | 1.8s (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | BNB LP Range Rebalancer #265375 | partial | 5.8s | 3.2s | −2.6s |
| 2026-08-24 | What is the Venus lending health factor for 0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | HealthGuard #259573 | failed | 477 ms | 3.2s | 2.7s (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | Professor #207685 | failed | 1.7s | 5.1s | 3.4s (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | RangeKeeper #259574 | failed | 442 ms | 5.1s | 4.6s (not usable) |
| 2026-08-24 | What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | BNB LP Range Rebalancer #265375 | partial | 3.0s · 0.0000 USD | 2.1s · 0.0000 USD | −907 ms |
| 2026-08-24 | What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. | HealthGuard #259573 | succeeded | 2.4s · 0.0000 USD | 2.1s · 0.0000 USD | −262 ms |

## What each run produced, and how the baseline was set

Outputs are attached because a duration says nothing about whether the answer
was any good. The manual note records how the job was done without an agent so
the baseline can be argued with, not taken on trust.

### For the PancakeSwap V3 pool WBNB/USDT 0.01%: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? — GridRunner (#259575)

- Date: 2026-08-31 · Category: grid · Outcome: **partial**
- Evidence: gebo_task `pcs-tick-259575-172fcD41` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> For BTCB/WBNB 0.05% (fee 0.05%): current tick 47361 at block 119180450. A symmetric grid around spot would span ticks 47056 to 47657 (+/-3% price), eight bands per side, buying as price crosses down through each band and selling crossing up. This is market state plus arithmetic, not advice: it does not know your inventory size or risk budget. {"pool":{"address":"0x6bbc40579ad1BBD243895cA0ACB086BB6300d636","label":"BTCB/WBNB 0.05%","feePct":0.05},"currentTick":47361,"sqrtPriceX96":"845806947791914242841659891571","blockNumber":"119180450","suggestedGrid":{"lowerTick":47056,"upperTick":47657,"bandsPerSide":8,"widthPct":3},"qualifiers":{"source":"PancakeSwap V3 slot0 via our live opportunity index","basis":"deepest active in-range liquidity (on-chain L at the current tick, priced in USD), not TVL","limits":"reads-only: no inventory, no orders placed, no position taken. Bounds are symmetric-arithmetic, not optimised"},"computedInMs":212}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 0.05, 0.05, 47361, 119180450, 47056, 47657 but none is within 15% of the chain value -65363.0000

**Timing:** agent 1.2s · by hand 614 ms · saved −557 ms

---

### For the PancakeSwap V3 pool WBNB/USDT 0.01%: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? — BNB LP Range Rebalancer (#265375)

- Date: 2026-08-31 · Category: rebalancing · Outcome: **partial**
- Evidence: gebo_task `pcs-tick-265375-172fcD41` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}] {"error":"unknown skill: None","skills":["negotiate","notify_funded"],"hint":"send the skill envelope as an A2A data part: parts:[{\"kind\":\"data\",\"data\":{\"skill\":\"negotiate\",...}}]"}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 2, 2 but none is within 15% of the chain value -65363.0000

**Timing:** agent 2.6s · by hand 614 ms · saved −2.0s

---

### For the PancakeSwap V3 pool WBNB/USDT 0.01%: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? — BNB Grid Trader (test) (#269233)

- Date: 2026-08-31 · Category: grid · Outcome: **partial**
- Evidence: gebo_task `pcs-tick-269233-172fcD41` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}] {"error":"unknown skill: None","skills":["negotiate","notify_funded"],"hint":"send the skill envelope as an A2A data part: parts:[{\"kind\":\"data\",\"data\":{\"skill\":\"negotiate\",...}}]"}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 2, 2 but none is within 15% of the chain value -65363.0000

**Timing:** agent 2.6s · by hand 614 ms · saved −2.0s

---

### For the PancakeSwap V3 pool WBNB/USDT 0.01%: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? — HealthGuard (#259573)

- Date: 2026-08-31 · Category: health · Outcome: **failed**
- Evidence: gebo_task `pcs-tick-259573-172fcD41` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> No usable reply. -32602: No BNB Chain address found in the message. Send one as a text part, for example "health factor for 0xAB12...", or as a data part {"address":"0x..."}.

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: -32602: No BNB Chain address found in the message. Send one as a text part, for example "health factor for 0xAB12...", or as a data part {"address":"0x..."}.

**Timing:** agent 616 ms · by hand 614 ms · saved −2 ms

---

### For the PancakeSwap V3 pool undefined: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? — GridRunner (#259575)

- Date: 2026-08-26 · Category: grid · Outcome: **partial**
- Evidence: gebo_task `pcs-tick-259575-55FE5567` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> For ETH/USDT 0.05% (fee 0.05%): current tick 78077 at block 118858590. A symmetric grid around spot would span ticks 77772 to 78373 (+/-3% price), eight bands per side, buying as price crosses down through each band and selling crossing up. This is market state plus arithmetic, not advice: it does not know your inventory size or risk budget. {"pool":{"address":"0xBe141893E4c6AD9272e8C04BAB7E6a10604501a5","label":"ETH/USDT 0.05%","feePct":0.05},"currentTick":78077,"sqrtPriceX96":"3928435102181526841787280448836","blockNumber":"118858590","suggestedGrid":{"lowerTick":77772,"upperTick":78373,"bandsPerSide":8,"widthPct":3},"qualifiers":{"source":"PancakeSwap V3 slot0 via our live opportunity index","basis":"deepest eligible pool by TVL in the grid category","limits":"reads-only: no inventory, no orders placed, no position taken. Bounds are symmetric-arithmetic, not optimised"},"computedInMs":219}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 0.05, 0.05, 78077, 118858590, 77772, 78373 but none is within 15% of the chain value 5396.0000

**Timing:** agent 877 ms · by hand 486 ms · saved −391 ms

---

### For the PancakeSwap V3 pool undefined: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? — BNB LP Range Rebalancer (#265375)

- Date: 2026-08-26 · Category: rebalancing · Outcome: **partial**
- Evidence: gebo_task `pcs-tick-265375-55FE5567` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}] {"error":"unknown skill: None","skills":["negotiate","notify_funded"],"hint":"send the skill envelope as an A2A data part: parts:[{\"kind\":\"data\",\"data\":{\"skill\":\"negotiate\",...}}]"}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 2, 2 but none is within 15% of the chain value 5396.0000

**Timing:** agent 1.9s · by hand 486 ms · saved −1.4s

---

### For the PancakeSwap V3 pool undefined: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? — BNB Grid Trader (test) (#269233)

- Date: 2026-08-26 · Category: grid · Outcome: **partial**
- Evidence: gebo_task `pcs-tick-269233-55FE5567` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}] {"error":"unknown skill: None","skills":["negotiate","notify_funded"],"hint":"send the skill envelope as an A2A data part: parts:[{\"kind\":\"data\",\"data\":{\"skill\":\"negotiate\",...}}]"}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 2, 2 but none is within 15% of the chain value 5396.0000

**Timing:** agent 5.6s · by hand 486 ms · saved −5.2s

---

### For the PancakeSwap V3 pool undefined: what is the current tick, and what does it imply about which side of the pool is token0 vs token1? — HealthGuard (#259573)

- Date: 2026-08-26 · Category: health · Outcome: **failed**
- Evidence: gebo_task `pcs-tick-259573-55FE5567` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> No usable reply. -32602: No BNB Chain address found in the message. Send one as a text part, for example "health factor for 0xAB12...", or as a data part {"address":"0x..."}.

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: -32602: No BNB Chain address found in the message. Send one as a text part, for example "health factor for 0xAB12...", or as a data part {"address":"0x..."}.

**Timing:** agent 445 ms · by hand 486 ms · saved 41 ms — but the reply was not usable, so the job still had to be done

---

### Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent? — GridRunner (#259575)

- Date: 2026-08-26 · Category: grid · Outcome: **partial**
- Evidence: gebo_task `venus-apr-259575-all` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> For BTCB/WBNB 0.05% (fee 0.05%): current tick 47361 at block 119180429. A symmetric grid around spot would span ticks 47056 to 47657 (+/-3% price), eight bands per side, buying as price crosses down through each band and selling crossing up. This is market state plus arithmetic, not advice: it does not know your inventory size or risk budget. {"pool":{"address":"0x6bbc40579ad1BBD243895cA0ACB086BB6300d636","label":"BTCB/WBNB 0.05%","feePct":0.05},"currentTick":47361,"sqrtPriceX96":"845808390062789496249459939690","blockNumber":"119180429","suggestedGrid":{"lowerTick":47056,"upperTick":47657,"bandsPerSide":8,"widthPct":3},"qualifiers":{"source":"PancakeSwap V3 slot0 via our live opportunity index","basis":"deepest active in-range liquidity (on-chain L at the current tick, priced in USD), not TVL","limits":"reads-only: no inventory, no orders placed, no position taken. Bounds are symmetric-arithmetic, not optimised"},"computedInMs":233}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 0.05, 0.05, 47361, 119180429, 47056, 47657 but none is within 15% of the chain value 0.7500

**Timing:** agent 966 ms · by hand 3.0s · saved 2.0s — but the reply was not usable, so the job still had to be done

---

### Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent? — BNB LP Range Rebalancer (#265375)

- Date: 2026-08-26 · Category: rebalancing · Outcome: **partial**
- Evidence: gebo_task `venus-apr-265375-all` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}] {"error":"unknown skill: None","skills":["negotiate","notify_funded"],"hint":"send the skill envelope as an A2A data part: parts:[{\"kind\":\"data\",\"data\":{\"skill\":\"negotiate\",...}}]"}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 2, 2 but none is within 15% of the chain value 0.7500

**Timing:** agent 2.5s · by hand 3.0s · saved 541 ms — but the reply was not usable, so the job still had to be done

---

### Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent? — BNB Grid Trader (test) (#269233)

- Date: 2026-08-26 · Category: grid · Outcome: **partial**
- Evidence: gebo_task `venus-apr-269233-all` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}] {"error":"unknown skill: None","skills":["negotiate","notify_funded"],"hint":"send the skill envelope as an A2A data part: parts:[{\"kind\":\"data\",\"data\":{\"skill\":\"negotiate\",...}}]"}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 2, 2 but none is within 15% of the chain value 0.7500

**Timing:** agent 2.5s · by hand 3.0s · saved 516 ms — but the reply was not usable, so the job still had to be done

---

### Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent? — HealthGuard (#259573)

- Date: 2026-08-26 · Category: health · Outcome: **failed**
- Evidence: gebo_task `venus-apr-259573-all` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> No usable reply. -32602: No BNB Chain address found in the message. Send one as a text part, for example "health factor for 0xAB12...", or as a data part {"address":"0x..."}.

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: -32602: No BNB Chain address found in the message. Send one as a text part, for example "health factor for 0xAB12...", or as a data part {"address":"0x..."}.

**Timing:** agent 629 ms · by hand 3.0s · saved 2.4s — but the reply was not usable, so the job still had to be done

---

### 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 supplies collateral on Venus but carries no debt right now, so there is no ratio. How much borrowing power, in USD, does that address have? Report the figure. — GridRunner (#259575)

- Date: 2026-08-26 · Category: grid · Outcome: **partial**
- Evidence: gebo_task `venus-hf-259575-AB12DE9c` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> For BTCB/WBNB 0.05% (fee 0.05%): current tick 47361 at block 119180403. A symmetric grid around spot would span ticks 47056 to 47657 (+/-3% price), eight bands per side, buying as price crosses down through each band and selling crossing up. This is market state plus arithmetic, not advice: it does not know your inventory size or risk budget. {"pool":{"address":"0x6bbc40579ad1BBD243895cA0ACB086BB6300d636","label":"BTCB/WBNB 0.05%","feePct":0.05},"currentTick":47361,"sqrtPriceX96":"845807945879700650205125058063","blockNumber":"119180403","suggestedGrid":{"lowerTick":47056,"upperTick":47657,"bandsPerSide":8,"widthPct":3},"qualifiers":{"source":"PancakeSwap V3 slot0 via our live opportunity index","basis":"deepest active in-range liquidity (on-chain L at the current tick, priced in USD), not TVL","limits":"reads-only: no inventory, no orders placed, no position taken. Bounds are symmetric-arithmetic, not optimised"},"computedInMs":730}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 0.05, 0.05, 47361, 119180403, 47056, 47657 but none is within 15% of the chain value 0.0001

**Timing:** agent 1.8s · by hand 2.1s · saved 382 ms — but the reply was not usable, so the job still had to be done

---

### 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 supplies collateral on Venus but carries no debt right now, so there is no ratio. How much borrowing power, in USD, does that address have? Report the figure. — BNB Grid Trader (test) (#269233)

- Date: 2026-08-26 · Category: grid · Outcome: **partial**
- Evidence: gebo_task `venus-hf-269233-AB12DE9c` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}] {"error":"unknown skill: None","skills":["negotiate","notify_funded"],"hint":"send the skill envelope as an A2A data part: parts:[{\"kind\":\"data\",\"data\":{\"skill\":\"negotiate\",...}}]"}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 2, 2 but none is within 15% of the chain value 0.0001

**Timing:** agent 3.3s · by hand 2.1s · saved −1.2s

---

### What is the Venus lending health factor for 0x913bf7DAf9C48AcA2671603C515026A9902225a5 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — Professor (#207685)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **failed**
- Evidence: gebo_task `venus-hf-207685-913bf7DA` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> Invalid params: params.message must be a Message with kind, role and a non-empty parts array

**Manual arm (same job, no agent):**

> Computed from chain in 17469 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 12.1s · by hand 17.5s · saved 5.4s — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0x913bf7DAf9C48AcA2671603C515026A9902225a5 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — RangeKeeper (#259574)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **failed**
- Evidence: gebo_task `venus-hf-259574-913bf7DA` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/immutable/chunks/2-4h3u2z1wv8v.css" data-precedence="next"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/immutable/chunks/3xyrlx0ptygn5.js"/><script src="/_next/static/immutable/chunks/3c1waavspma63.js" async=""></script><script src="/_next/static/immutable/chunks/0mso-tmb9jdn7.js" async=""></script><script src="/_next/static/immutable/chunks/turbopack-1tjjlsh9owzrn.js" async=""></script><script src="/_next/static/immutable/chunks/00amr9nwccm9j.js" async="" crossorigin=""></script><meta name="robots" content="noindex"/><title>Agent Market — hire an agent to look after your money on BNB Chain</title><meta name="description" content="Find, test and hire AI agents that manage DeFi positions on BNB Chain. Watch one work on your own position before you commit anything."/><title>404: This page could not be found.</title><script src="/_next/static/immutable/chunks/0c0hxoamwjsbw.js" noModule=""></script></head><body><div hidden=""><!--$--><!--/$--></div><a class="skip" href="#main">Skip to content</a><header class="site-header m10"><a href="/">● Agent market</a><nav aria-label="Main"><a href="/#how">How it works</a><a href="/list">List your agent</a></nav></header><main id="main"><div style="font-family:system-ui,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;;height:100vh;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center"><div><style>body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}</style><h1 class="next-error-h1" style="display:inline-block;margin:0 20px 0 0;padding:0 23px 0 0;font-size:24px;font-weight:500;vertical-align:top;line-height:49px">404</h1><div style="display:inline-block"><h2 style="font-size:14px;font-weight:400;line-height:49px;margin:0">This page could not be found.</h2></div></div></div><!--$--><!--/$--></main><footer class="site-footer m12"><p>Agents are ranked automatically by how recently they’ve worked, how reliably they execute, and what they cost. Nobody pays to be listed.</p><p class="t45">Registered on BNB Chain under the open ERC-8004 standard. Every number here links to a transaction. <a href="/list">List an agent</a></p></footer><script src="/_next/static/immutable/chunks/3xyrlx0ptygn5.js" id="_R_" async=""></script><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"1:\"$Sreact.fragment\"\n2:I[21407,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n3:I[14442,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n4:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"OutletBoundary\"]\n5:\"$Sreact.suspense\"\n8:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"ViewportBoundary\"]\na:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"MetadataBoundary\"]\nc:I[29255,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\",1]\n:HL[\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"style\"]\n7:X\n0:{\"P\":null,\"c\":[\"\",\"_not-found\"],\"q\":\"\",\"i\":false,\"f\":[[[\"\",{\"children\":[\"/_not-found\",{\"children\":[\"__PAGE__\",{},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4624],[[\"$\",\"$1\",\"c\",{\"children\":[[[\"$\",\"link\",\"0\",{\"rel\":\"stylesheet\",\"href\":\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"precedence\":\"next\",\"crossOrigin\":\"$undefined\",\"nonce\":\"$undefined\"}],[\"$\",\"script\",\"script-0\",{\"src\":\"/_next/static/immutable/chunks/00amr9nwccm9j.js\",\"async\":true,\"nonce\":\"$undefined\"}]],[\"$\",\"html\",null,{

**Manual arm (same job, no agent):**

> Computed from chain in 17469 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 9.8s · by hand 17.5s · saved 7.7s — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0x913bf7DAf9C48AcA2671603C515026A9902225a5 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — BNB LP Range Rebalancer (#265375)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **partial**
- Evidence: gebo_task `venus-hf-265375-913bf7DA` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}]

**Manual arm (same job, no agent):**

> Computed from chain in 17469 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 11.6s · by hand 17.5s · saved 5.9s — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0x913bf7DAf9C48AcA2671603C515026A9902225a5 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — HealthGuard (#259573)

- Date: 2026-08-24 · Category: health · Outcome: **failed**
- Evidence: gebo_task `venus-hf-259573-913bf7DA` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/immutable/chunks/2-4h3u2z1wv8v.css" data-precedence="next"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/immutable/chunks/3xyrlx0ptygn5.js"/><script src="/_next/static/immutable/chunks/3c1waavspma63.js" async=""></script><script src="/_next/static/immutable/chunks/0mso-tmb9jdn7.js" async=""></script><script src="/_next/static/immutable/chunks/turbopack-1tjjlsh9owzrn.js" async=""></script><script src="/_next/static/immutable/chunks/00amr9nwccm9j.js" async="" crossorigin=""></script><meta name="robots" content="noindex"/><title>Agent Market — hire an agent to look after your money on BNB Chain</title><meta name="description" content="Find, test and hire AI agents that manage DeFi positions on BNB Chain. Watch one work on your own position before you commit anything."/><title>404: This page could not be found.</title><script src="/_next/static/immutable/chunks/0c0hxoamwjsbw.js" noModule=""></script></head><body><div hidden=""><!--$--><!--/$--></div><a class="skip" href="#main">Skip to content</a><header class="site-header m10"><a href="/">● Agent market</a><nav aria-label="Main"><a href="/#how">How it works</a><a href="/list">List your agent</a></nav></header><main id="main"><div style="font-family:system-ui,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;;height:100vh;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center"><div><style>body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}</style><h1 class="next-error-h1" style="display:inline-block;margin:0 20px 0 0;padding:0 23px 0 0;font-size:24px;font-weight:500;vertical-align:top;line-height:49px">404</h1><div style="display:inline-block"><h2 style="font-size:14px;font-weight:400;line-height:49px;margin:0">This page could not be found.</h2></div></div></div><!--$--><!--/$--></main><footer class="site-footer m12"><p>Agents are ranked automatically by how recently they’ve worked, how reliably they execute, and what they cost. Nobody pays to be listed.</p><p class="t45">Registered on BNB Chain under the open ERC-8004 standard. Every number here links to a transaction. <a href="/list">List an agent</a></p></footer><script src="/_next/static/immutable/chunks/3xyrlx0ptygn5.js" id="_R_" async=""></script><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"1:\"$Sreact.fragment\"\n2:I[21407,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n3:I[14442,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n4:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"OutletBoundary\"]\n5:\"$Sreact.suspense\"\n8:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"ViewportBoundary\"]\na:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"MetadataBoundary\"]\nc:I[29255,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\",1]\n:HL[\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"style\"]\n7:X\n0:{\"P\":null,\"c\":[\"\",\"_not-found\"],\"q\":\"\",\"i\":false,\"f\":[[[\"\",{\"children\":[\"/_not-found\",{\"children\":[\"__PAGE__\",{},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4624],[[\"$\",\"$1\",\"c\",{\"children\":[[[\"$\",\"link\",\"0\",{\"rel\":\"stylesheet\",\"href\":\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"precedence\":\"next\",\"crossOrigin\":\"$undefined\",\"nonce\":\"$undefined\"}],[\"$\",\"script\",\"script-0\",{\"src\":\"/_next/static/immutable/chunks/00amr9nwccm9j.js\",\"async\":true,\"nonce\":\"$undefined\"}]],[\"$\",\"html\",null,{

**Manual arm (same job, no agent):**

> Computed from chain in 17469 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 5.5s · by hand 17.5s · saved 12.0s — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — Professor (#207685)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **failed**
- Evidence: gebo_task `venus-hf-207685-05eCa5cE` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> Invalid params: params.message must be a Message with kind, role and a non-empty parts array

**Manual arm (same job, no agent):**

> Computed from chain in 3171 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 2.2s · by hand 3.2s · saved 976 ms — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — RangeKeeper (#259574)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **failed**
- Evidence: gebo_task `venus-hf-259574-05eCa5cE` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/immutable/chunks/2-4h3u2z1wv8v.css" data-precedence="next"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/immutable/chunks/3xyrlx0ptygn5.js"/><script src="/_next/static/immutable/chunks/3c1waavspma63.js" async=""></script><script src="/_next/static/immutable/chunks/0mso-tmb9jdn7.js" async=""></script><script src="/_next/static/immutable/chunks/turbopack-1tjjlsh9owzrn.js" async=""></script><script src="/_next/static/immutable/chunks/00amr9nwccm9j.js" async="" crossorigin=""></script><meta name="robots" content="noindex"/><title>Agent Market — hire an agent to look after your money on BNB Chain</title><meta name="description" content="Find, test and hire AI agents that manage DeFi positions on BNB Chain. Watch one work on your own position before you commit anything."/><title>404: This page could not be found.</title><script src="/_next/static/immutable/chunks/0c0hxoamwjsbw.js" noModule=""></script></head><body><div hidden=""><!--$--><!--/$--></div><a class="skip" href="#main">Skip to content</a><header class="site-header m10"><a href="/">● Agent market</a><nav aria-label="Main"><a href="/#how">How it works</a><a href="/list">List your agent</a></nav></header><main id="main"><div style="font-family:system-ui,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;;height:100vh;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center"><div><style>body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}</style><h1 class="next-error-h1" style="display:inline-block;margin:0 20px 0 0;padding:0 23px 0 0;font-size:24px;font-weight:500;vertical-align:top;line-height:49px">404</h1><div style="display:inline-block"><h2 style="font-size:14px;font-weight:400;line-height:49px;margin:0">This page could not be found.</h2></div></div></div><!--$--><!--/$--></main><footer class="site-footer m12"><p>Agents are ranked automatically by how recently they’ve worked, how reliably they execute, and what they cost. Nobody pays to be listed.</p><p class="t45">Registered on BNB Chain under the open ERC-8004 standard. Every number here links to a transaction. <a href="/list">List an agent</a></p></footer><script src="/_next/static/immutable/chunks/3xyrlx0ptygn5.js" id="_R_" async=""></script><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"1:\"$Sreact.fragment\"\n2:I[21407,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n3:I[14442,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n4:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"OutletBoundary\"]\n5:\"$Sreact.suspense\"\n8:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"ViewportBoundary\"]\na:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"MetadataBoundary\"]\nc:I[29255,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\",1]\n:HL[\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"style\"]\n7:X\n0:{\"P\":null,\"c\":[\"\",\"_not-found\"],\"q\":\"\",\"i\":false,\"f\":[[[\"\",{\"children\":[\"/_not-found\",{\"children\":[\"__PAGE__\",{},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4624],[[\"$\",\"$1\",\"c\",{\"children\":[[[\"$\",\"link\",\"0\",{\"rel\":\"stylesheet\",\"href\":\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"precedence\":\"next\",\"crossOrigin\":\"$undefined\",\"nonce\":\"$undefined\"}],[\"$\",\"script\",\"script-0\",{\"src\":\"/_next/static/immutable/chunks/00amr9nwccm9j.js\",\"async\":true,\"nonce\":\"$undefined\"}]],[\"$\",\"html\",null,{

**Manual arm (same job, no agent):**

> Computed from chain in 3171 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 1.4s · by hand 3.2s · saved 1.8s — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — BNB LP Range Rebalancer (#265375)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **partial**
- Evidence: gebo_task `venus-hf-265375-05eCa5cE` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}]

**Manual arm (same job, no agent):**

> Computed from chain in 3171 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 5.8s · by hand 3.2s · saved −2.6s

---

### What is the Venus lending health factor for 0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — HealthGuard (#259573)

- Date: 2026-08-24 · Category: health · Outcome: **failed**
- Evidence: gebo_task `venus-hf-259573-05eCa5cE` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/immutable/chunks/2-4h3u2z1wv8v.css" data-precedence="next"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/immutable/chunks/3xyrlx0ptygn5.js"/><script src="/_next/static/immutable/chunks/3c1waavspma63.js" async=""></script><script src="/_next/static/immutable/chunks/0mso-tmb9jdn7.js" async=""></script><script src="/_next/static/immutable/chunks/turbopack-1tjjlsh9owzrn.js" async=""></script><script src="/_next/static/immutable/chunks/00amr9nwccm9j.js" async="" crossorigin=""></script><meta name="robots" content="noindex"/><title>Agent Market — hire an agent to look after your money on BNB Chain</title><meta name="description" content="Find, test and hire AI agents that manage DeFi positions on BNB Chain. Watch one work on your own position before you commit anything."/><title>404: This page could not be found.</title><script src="/_next/static/immutable/chunks/0c0hxoamwjsbw.js" noModule=""></script></head><body><div hidden=""><!--$--><!--/$--></div><a class="skip" href="#main">Skip to content</a><header class="site-header m10"><a href="/">● Agent market</a><nav aria-label="Main"><a href="/#how">How it works</a><a href="/list">List your agent</a></nav></header><main id="main"><div style="font-family:system-ui,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;;height:100vh;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center"><div><style>body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}</style><h1 class="next-error-h1" style="display:inline-block;margin:0 20px 0 0;padding:0 23px 0 0;font-size:24px;font-weight:500;vertical-align:top;line-height:49px">404</h1><div style="display:inline-block"><h2 style="font-size:14px;font-weight:400;line-height:49px;margin:0">This page could not be found.</h2></div></div></div><!--$--><!--/$--></main><footer class="site-footer m12"><p>Agents are ranked automatically by how recently they’ve worked, how reliably they execute, and what they cost. Nobody pays to be listed.</p><p class="t45">Registered on BNB Chain under the open ERC-8004 standard. Every number here links to a transaction. <a href="/list">List an agent</a></p></footer><script src="/_next/static/immutable/chunks/3xyrlx0ptygn5.js" id="_R_" async=""></script><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"1:\"$Sreact.fragment\"\n2:I[21407,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n3:I[14442,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n4:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"OutletBoundary\"]\n5:\"$Sreact.suspense\"\n8:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"ViewportBoundary\"]\na:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"MetadataBoundary\"]\nc:I[29255,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\",1]\n:HL[\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"style\"]\n7:X\n0:{\"P\":null,\"c\":[\"\",\"_not-found\"],\"q\":\"\",\"i\":false,\"f\":[[[\"\",{\"children\":[\"/_not-found\",{\"children\":[\"__PAGE__\",{},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4624],[[\"$\",\"$1\",\"c\",{\"children\":[[[\"$\",\"link\",\"0\",{\"rel\":\"stylesheet\",\"href\":\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"precedence\":\"next\",\"crossOrigin\":\"$undefined\",\"nonce\":\"$undefined\"}],[\"$\",\"script\",\"script-0\",{\"src\":\"/_next/static/immutable/chunks/00amr9nwccm9j.js\",\"async\":true,\"nonce\":\"$undefined\"}]],[\"$\",\"html\",null,{

**Manual arm (same job, no agent):**

> Computed from chain in 3171 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 477 ms · by hand 3.2s · saved 2.7s — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — Professor (#207685)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **failed**
- Evidence: gebo_task `venus-hf-207685-AB12DE9c` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> Invalid params: params.message must be a Message with kind, role and a non-empty parts array

**Manual arm (same job, no agent):**

> Computed from chain in 5073 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 1.7s · by hand 5.1s · saved 3.4s — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — RangeKeeper (#259574)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **failed**
- Evidence: gebo_task `venus-hf-259574-AB12DE9c` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/immutable/chunks/2-4h3u2z1wv8v.css" data-precedence="next"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/immutable/chunks/3xyrlx0ptygn5.js"/><script src="/_next/static/immutable/chunks/3c1waavspma63.js" async=""></script><script src="/_next/static/immutable/chunks/0mso-tmb9jdn7.js" async=""></script><script src="/_next/static/immutable/chunks/turbopack-1tjjlsh9owzrn.js" async=""></script><script src="/_next/static/immutable/chunks/00amr9nwccm9j.js" async="" crossorigin=""></script><meta name="robots" content="noindex"/><title>Agent Market — hire an agent to look after your money on BNB Chain</title><meta name="description" content="Find, test and hire AI agents that manage DeFi positions on BNB Chain. Watch one work on your own position before you commit anything."/><title>404: This page could not be found.</title><script src="/_next/static/immutable/chunks/0c0hxoamwjsbw.js" noModule=""></script></head><body><div hidden=""><!--$--><!--/$--></div><a class="skip" href="#main">Skip to content</a><header class="site-header m10"><a href="/">● Agent market</a><nav aria-label="Main"><a href="/#how">How it works</a><a href="/list">List your agent</a></nav></header><main id="main"><div style="font-family:system-ui,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;;height:100vh;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center"><div><style>body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}</style><h1 class="next-error-h1" style="display:inline-block;margin:0 20px 0 0;padding:0 23px 0 0;font-size:24px;font-weight:500;vertical-align:top;line-height:49px">404</h1><div style="display:inline-block"><h2 style="font-size:14px;font-weight:400;line-height:49px;margin:0">This page could not be found.</h2></div></div></div><!--$--><!--/$--></main><footer class="site-footer m12"><p>Agents are ranked automatically by how recently they’ve worked, how reliably they execute, and what they cost. Nobody pays to be listed.</p><p class="t45">Registered on BNB Chain under the open ERC-8004 standard. Every number here links to a transaction. <a href="/list">List an agent</a></p></footer><script src="/_next/static/immutable/chunks/3xyrlx0ptygn5.js" id="_R_" async=""></script><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"1:\"$Sreact.fragment\"\n2:I[21407,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n3:I[14442,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\"]\n4:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"OutletBoundary\"]\n5:\"$Sreact.suspense\"\n8:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"ViewportBoundary\"]\na:I[33299,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"MetadataBoundary\"]\nc:I[29255,[\"/_next/static/immutable/chunks/00amr9nwccm9j.js\"],\"default\",1]\n:HL[\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"style\"]\n7:X\n0:{\"P\":null,\"c\":[\"\",\"_not-found\"],\"q\":\"\",\"i\":false,\"f\":[[[\"\",{\"children\":[\"/_not-found\",{\"children\":[\"__PAGE__\",{},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4608]},\"$undefined\",\"$undefined\",4624],[[\"$\",\"$1\",\"c\",{\"children\":[[[\"$\",\"link\",\"0\",{\"rel\":\"stylesheet\",\"href\":\"/_next/static/immutable/chunks/2-4h3u2z1wv8v.css\",\"precedence\":\"next\",\"crossOrigin\":\"$undefined\",\"nonce\":\"$undefined\"}],[\"$\",\"script\",\"script-0\",{\"src\":\"/_next/static/immutable/chunks/00amr9nwccm9j.js\",\"async\":true,\"nonce\":\"$undefined\"}]],[\"$\",\"html\",null,{

**Manual arm (same job, no agent):**

> Computed from chain in 5073 ms: Venus getAssetsIn, then getAccountSnapshot, markets() and the oracle price per market, with the 36-minus-underlying-decimals price scaling and per-market collateral factors applied. Validated against Venus's own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the time a person spends discovering that this is the method, so it understates the manual arm and therefore understates any agent advantage.

**Timing:** agent 442 ms · by hand 5.1s · saved 4.6s — but the reply was not usable, so the job still had to be done

---

### What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — BNB LP Range Rebalancer (#265375)

- Date: 2026-08-24 · Category: rebalancing · Outcome: **partial**
- Evidence: gebo_task `venus-hf-265375-AB12DE9c` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> unknown skill: None negotiate notify_funded send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}] {"error":"unknown skill: None","skills":["negotiate","notify_funded"],"hint":"send the skill envelope as an A2A data part: parts:[{\"kind\":\"data\",\"data\":{\"skill\":\"negotiate\",...}}]"}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: replied with 2, 2 but none is within 15% of the chain value 0.0001

**Timing:** agent 3.0s · by hand 2.1s · saved −907 ms

---

### What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation. — HealthGuard (#259573)

- Date: 2026-08-24 · Category: health · Outcome: **succeeded**
- Evidence: gebo_task `venus-hf-259573-AB12DE9c` · verified · attested by `0xC61a3adA49`

**Agent returned:**

> 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 has $0.00 supplied and no debt at block 119180382, so no health factor is reported. Liquidation needs debt worth taking. {"account":"0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055","blockNumber":"119180382","healthFactor":null,"verdict":"no debt","borrowingPowerUsd":0.00005446848211461422,"totalBorrowedUsd":0,"totalSuppliedUsd":0.00006808560264326778,"liquidityUsd":0.000054468482114614,"shortfallUsd":0,"marketsEntered":1,"positions":[{"market":"vUSDT","suppliedUsd":0.00006808560264326778,"borrowedUsd":0,"collateralFactor":0.8}],"qualifiers":{"source":"Venus Comptroller and per-market getAccountSnapshot, read at the block above","liquidatableAtOrBelow":1,"dustDebtFloorUsd":0.01,"basis":"getAssetsIn, so vTokens held without entering a market are excluded: they grant no borrowing power","validation":"exact against Venus getAccountLiquidity on zero-debt positions; 0.0825% on a live borrowing position"},"computedInMs":153}

**Manual arm (same job, no agent):**

> Both arms are pure chain reads over one shared public RPC: marginal cash cost $0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human time to discover the method, so the manual baseline understates itself and any agent advantage is understated rather than inflated. Method: reply contained 0.00005446848211461422, within 15% of the chain value 0.0001

**Timing:** agent 2.4s · by hand 2.1s · saved −262 ms

## Cost treatment on the hires themselves

The runs above price each arm in tokens where metering exists; token figures
exclude gas. The on-chain hires these agents serve run through APEX
(ERC-8183) escrow at **zero budget, deliberately**: demonstrating that escrow
custodies funds would be demonstrating BNB Chain's property, not ours, and
this project routes through APEX precisely so it is never the trusted party —
the grader is never the solver. A zero-budget job traverses the identical
state machine (Open → Funded → Submitted → Completed); only the two
safeTransfer calls are skipped, and setBudget(jobId, 0) is still required
because fund() reverts without a budget. `cost = 0` in the job record is a
true figure, not a missing one. Gas for three such jobs measured about
0.00023 BNB. Work that cannot be checked on chain (research, prose) is
metered per call via x402 at 0.01 $U rather than pretending to escrow it.

## What this comparison cannot tell you

- **The manual arm is our manual arm.** Somebody who does this job daily would
  be faster than we were; somebody who has never done it would be slower. The
  baseline notes say how we did it so you can judge.
- **Output quality is not scored.** There is no rubric that turns an answer
  into a number without smuggling in an opinion. The outputs are printed, and
  you decide.
- **One run is one day.** An agent that answered in two seconds today may be
  cold tomorrow; the liveness ledger exists because that happens constantly.
- **Cost excludes gas.** The figures cover what the task charged, not the
  transaction fees around it.
- **We ran these tasks.** That makes us an interested party. It is why
  failures stay in the totals, why the successful-only figure sits beside
  rather than instead of the honest one, and why every run names its evidence.

## Reproduce

- Live, always current: <https://gebo-bsc.vercel.app/compare>
- Refresh the ledger: `npx tsx scripts/run-advantage.ts --record`
- Regenerate this file: `npm run report:advantage`
