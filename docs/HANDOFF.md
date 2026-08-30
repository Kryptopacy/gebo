# Session handoff - 2026-08-30

Supplement to AGENTS.md, not a replacement. `npm run readiness` remains the source
of truth for what is DONE; this file records what readiness cannot see: in-flight
steps, session-specific gotchas, and the exact next actions.

## Resume status - 2026-08-30 (second session: the trading track record)

TermiX's 20% criterion demands trading agents carry "a real record: win rate,
the window, and the risk taken". Nothing in the DB satisfied that (only
uptime/latency + task attestations). Built this session, all verified:

- **Grid trading record, replay-measured.** The grid reference agent's advised
  strategy (+/-3% symmetric grid, 8 bands/side, deepest eligible pool) replayed
  over the market that actually happened. `src/lib/grid-record.ts` (simulator,
  pure, 15 tests) + `src/lib/grid-record-run.ts` (shared compute) +
  `scripts/grid-track-record.ts` (CLI) + `/api/cron/grid-record` (daily 07:17
  UTC, migration 0016) + a readiness gate. Renders on `/a/259575` in the Track
  record tab with every defect disclosed inline.
- **Honest 30d result on BTCB/WBNB 0.05% (deepest eligible venue):** 56/56
  round-trips won (band width 0.375% vs 0.1% round-trip fees — mechanical, and
  disclosed), total PnL +$27 on $1000, BUT holding beat it by ~$172 and
  doing-nothing by ~$140; max drawdown 6.1%. A negative result, published as
  one. 7d window had 0 closed trips (monotonic week) → win-rate row skipped,
  rendered as explicit absence, never zero.
- **"Deepest pool" ordering was silently ARBITRARY for weeks.** Every consumer
  ordered by `(payload->>'tvlUsd')` — a field no writer ever produced
  (the cron writes `liquidity`, raw V3 L). The grid agent had been advising a
  1%-fee CAKE/USDT pool with 2000x less depth than the 0.01% tier. Fixed:
  cron now computes `depthUsd` (2·L·√P priced in token1, a marginal-depth
  proxy — labeled as such, not TVL), stable/stable pairs are ineligible for
  grid ("nothing for a grid to trade"), and personas/run-advantage/the record
  all order by it. The record ALSO recomputes selection from raw fields at
  read time so a stale payload can't misdirect it again.
- **Price path source:** free BSC RPCs cap getLogs lookback (~5k blocks /
  publicnode), so no 7d+ pool-native swap history is reachable. The replay
  uses Binance 1m closes for both pool tokens ratioed into pool orientation,
  with a LIVE peg check (pool tick vs exchange ratio — currently -0.01%,
  well inside the 0.05% fee tier) that ABORTS the write if deviation exceeds
  the grid's own width. All disclosed in the metric qualifiers.
- **git on this box:** `git log`/`show` hang because the PAGER spawn wedges —
  always `cmd /c "git --no-pager ..."`. Separately, `.git\objects\e2`
  directory ENUMERATION is oplocked by something (D: is a backup volume);
  git opens objects by path so it works, but avoid `git gc`/`count-objects`
  until that clears. Stuck `git.exe` processes cascade-block new git startups;
  kill them first.

## Resume status - 2026-08-30

Everything in the 2026-08-29 section below still holds. New this session (all
verified, not asserted):

- Sessions regranted: 4 new grants (#9-#12), all `isValidKey=true` on chain;
  readiness back to **24/24** with 6 chain-valid keys. Expiry ≤48h means this
  needs a re-run before any judging window.
- Advantage attestations refreshed (`run-advantage.ts --record`, 12 rows):
  HealthGuard SUCCEEDED on venus-hf in 1843 ms vs 3515 ms manual; the grid
  agents' canned replies are recorded as PARTIAL, honest declines as FAILED.
- **x402 self-transfer bug found in PRODUCTION and fixed.** The deployed route
  fell back to `payTo = facilitator` because `X402_PAY_TO` was never set in
  Vercel's env; since the facilitator IS the demo owner, our own e2e buy
  (tx `0x27c4fe65…`) moved 0.01 $U buyer→buyer and the old script printed
  "paid 0" as success. Fixes: (1) the route's fallback is now the canonical
  receive-only address `0x2Fb9E5Cf…`, never the facilitator; (2)
  `scripts/x402-buy-health.ts` reads `payTo` from the 402 challenge and FAILS
  unless that address's balance rose by the price. Verified locally end to
  end: wallet 19.99 → 19.98, payTo 0.01 → 0.02 (tx `0x5c747feb…`).
- Wallet top-up: claimed 10 $U from the faucet (`0xc8ede6f9…`), now 19.98.

## Resume status - 2026-08-29

The wallet-hire build, the tabbed UIs, the resilient DB reads, and BOTH Altana
bonuses are done and verified on-chain. Everything below is measured, not asserted.

## Altana track: verified on-chain evidence (testnet, chain 97)

| Criterion | Status | Evidence |
| --- | --- | --- |
| Live onchain transactions in Altana explorer | ✅ | 8 grant txs, spike assertions (1 successful + 3 refusal reverts), ERC-8183 hire job 788, x402 settlement `0xe110f574…` |
| Sessions with real limits | ✅ | call allowlist + spend cap + expiry, byte-exact canonical JSON, pinned by `tests/session-scope.test.ts` |
| Sessions registered in Keystore, read onchain | ✅ | `/authority` reads getKeys/isValidKey/getPublicKey permissionlessly; readiness gate now counts CHAIN-valid keys (2 at last run) |
| Real onchain transactions through a session key | ✅ | spike assertion 2 (WBNB deposit) + the x402 purchase below (session key signed permit2-witness) |
| User-facing control + revoke in-product | ✅ | `/authority` per-key revoke control |
| ERC-8183 hire via Altana SDK (bonus) | ✅ | `scripts/hire-altana-sdk.ts` — job 788 FUNDED, tx `0xd48339a1…` |
| x402/B402 sell (bonus) | ✅ | `/api/agent/health/paid` — 0.01 $U/call, session-key purchase settled, receipt returned |
| Agents on their own Altana wallets | ⚠️ partial | one demo wallet (0x688Fe953…) plays owner/buyer/seller; per-agent wallets = post-contest |

## The x402 sell loop, end to end (reproduce with two commands)

1. `npx tsx scripts/claim-testnet-u.ts` — faucet `0x86e9…b5D3` pays 10 $U/30min
   to the caller (called via relay so the smart account is msg.sender).
2. `BASE=https://gebo-bsc.vercel.app npx tsx scripts/x402-buy-health.ts` —
   grants a session (1 $U/day spend cap), provisions permit2 (approve +
   signature checker), buys via `fetchWithX402`, prints the receipt and the
   wallet delta (10 → 9.99).

Hard-won facts in that loop:
- **eip3009 rejects session-key signatures** ("Invalid signature" revert in
  `transferWithAuthorization`). Altana smart-account buyers need the
  **permit2-exact** rail; the merchant offers BOTH (Studio buyers sign eip3009).
- Buyer-side provisioning is three steps: `approveTokenForPermit2`,
  `approveSignatureChecker(PERMIT2_ADDRESS)`, then `fetchWithX402`.
- `payTo` must differ from the buyer, or settlement is a self-transfer that
  leaves balances unchanged. Earnings now go to `X402_PAY_TO`
  (0x2Fb9E5CfebadbC77a9c1a42D96655F46d09D493d, key in `.env` as
  `X402_RECEIVE_KEY`).

## The ERC-8183 SDK hire: two paths, one gotcha

`hireErc8183Agent` fails on TESTNET with `PolicyNotWhitelisted` (selector
`0xc94463e3`): the SDK registry's testnet policy `0x4F4678D4…` is not whitelisted
by the router; the 15-minute-window policy `0xd6a42175…` (which every GEBO
testnet hire binds) is. `scripts/hire-altana-sdk.ts` tries the documented path
first and falls back to `client.execute(buildHireCalls(...))` with the
whitelisted policy — same SDK, same relay, one address swapped. On MAINNET the
SDK's address set matches our verified APEX set exactly and path 1 should work
(the mainnet demo wallet is unfunded, hence testnet).

## Correcting earlier notes

- AGENTS.md previously called `0x4f4678d4…` "the wrong OptimisticPolicy address".
  It is a real deployment (identical bytecode, 24h dispute window) that the
  testnet router does not (yet) whitelist. `0xd6a42175…` (15-min window) is the
  whitelisted one. Both have code; only one is usable with this router.
- The regrant cron (`app/api/cron/regrant/route.ts`) hardcoded CHAIN_ID 56 while
  every grant lives on testnet 97 — it would have failed its gas check on Sep 8
  and let sessions decay mid-judging. Now testnet, matching reality.
- The readiness `altana-sessions` gate counted DB rows; it now reads
  getKeys/isValidKey through the same `readAuthority()` the authority console
  uses. DB `state` stays "active" after expiry — bookkeeping, not truth.

## UI work landed this session

- Agent card: switcher pills (Overview/Authority/Registration/Track record),
  per-agent hire-vs-DIY advantage block, "Operated by GEBO" disclosure derived
  from request host + env URLs (never a hardcoded domain).
- Methodology: five tabs including "How categories evolve" (candidates ledger +
  corpus stats: 21,081 unclassified, 20 with skills, 34 with any text).
- Footer: four flagship jobs + "View all categories →" → new `/categories` page.
- Dropdown: right-anchored with viewport clamps (was overflowing the right edge).
- Tables: flat-tint hover + hairline accent (removed scale(1.01) + drop shadow),
  sticky headers under the masthead, center-aligned cells, light-theme hover
  fixed (was white-on-white), grid `min-width: 0` overflow guards.
- `app/overflow-guard.tsx`: dev-only guard logs any horizontal overflow with the
  offending selectors — no page can slip through a manual pass silently.
- Zero-budget wallet hire flow at `/a/{tokenId}/hire` (EIP-1193 + viem through
  APEX; hydration, job-race, and silent-reconnect fixes).
- Aggregates rewritten as ONE statement (five concurrent pooler connections timed
  out on every prod render — the empty-footer/notice bug); category pages read
  only their slug; search is sequential.

## BNB Agent Studio status (asked directly)

We did NOT use the Studio CLI — the four reference agents are hand-built Next.js
routes, ERC-8004-registered. The registry indexes Studio's AWS fleet (29 agents
on `ap-southeast-1.amazonaws.com`, 0 validated at last read — they do not answer
probes, which the registry reports honestly as DORMANT). Surfaces: 471 VERIFIED
agents, 469 validated on the latest probe day.

## IMMEDIATE next steps

1. Sessions expire ≤48h by design - re-run `npx tsx scripts/grant-demo-sessions.ts`
   before any judging window (last run 2026-08-30, sessions #9-#12).
2. Consider funding the mainnet demo wallet (~0.002 BNB) to run
   `hire-altana-sdk.ts --mainnet` — stronger evidence, one flag, no code change.
3. `npx tsx scripts/run-advantage.ts --record` for fresh attestations if judges
   re-run the TermiX evaluation (last run 2026-08-30, 12 rows).
4. Optional hygiene: set `X402_PAY_TO=0x2Fb9E5CfebadbC77a9c1a42D96655F46d09D493d`
   in the Vercel project env. The code default is now correct without it, but
   the env var keeps prod and local `.env` symmetric.
5. The grid trading record refreshes daily at 07:17 UTC (cron `gebo-grid-record`).
   If it fails, the grid_* rows self-expire after 26h and the readiness gate
   flips to PARTIAL/MISSING - that absence on the card is the designed signal,
   not a bug to paper over.

## Gotchas carried forward

- **Vercel builds fail on uncommitted imports** — clean-checkout compile before
  pushing (`git worktree add` + `mklink /J node_modules`).
- **Pooler concurrency stalls** — one connection, one statement per read path.
- **Windows PS 5.1**: no heredocs (use `git commit -F file`), backtick mangling
  in inline node -e (write .cjs files), Set-Content writes CP1252.
- **Session JSON is never re-serialised** — Altana matches bytes.
- The x402 buyer must run server-side (CORS on third-party endpoints).
