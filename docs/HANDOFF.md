# Session handoff - 2026-08-26

Supplement to AGENTS.md, not a replacement. `npm run readiness` remains the source
of truth for what is DONE; this file records what readiness cannot see: in-flight
steps, session-specific gotchas, and the exact next actions.
## Resume status - 2026-08-27

What the 08-26 queue got wrong (a READER of the earlier list would do wasted work):

- **Registration repair (step 1): verified done.** Tokens 259573/574/575/576 point
  to `https://gebo-bsc.vercel.app/api/agent/{health,rebalance,grid,yield}/card`
  and are all `VERIFIED` in `agent_endpoints`. `scripts/tmp-owners.ts` already ran.
- **Advantage harness (steps 2-3): done.** readiness shows `runs=22` and
  `attestations=27`.
- **Concurrent UI agent decommissioned 2026-08-27.** The "swept into its commit"
  hazard in AGENTS.md is historical; Kilo is the only agent now. The rule (commit
  promptly, check `git log --stat`) still stands.

Still open, and still worth doing (all measured/code-verified, not from this list):

1. **Migration 0015 (`0015_regrant_sessions.sql`) not applied** - no `gebo-regrant-1/2`
   in `cron.job`. The Sep 8/9 judging-window re-grant is not scheduled. Apply with
   `npm run migrate` (idempotent), then confirm with `npm run cron:status`. ✅ DONE
2. **Altana sessions are testnet (chain 97)**: 4 sessions granted, expire ≤48h by design.
   **Testnet satisfies the Altana bounty requirement** (must show live onchain transactions in Altana explorer, testnet or mainnet). Mainnet is stronger evidence for judges but not required.
   Current testnet sessions expired; readiness gate `altana-sessions` shows 0 live. Re-run `grant-demo-sessions.ts` to refresh before judging.
3. **Category payload asymmetry still open** (`grid`/`yield` share one schema each;
   rebalancing+grid share PancakeSwap; yield+health share Venus; spec wants more).
4. `task-grade` "scaffold" test was broken (fixture's own hex address held a `2`),
   not the grader. Fixed locally; see AGENTS.md for how (/authority now scoped).

## Landed this session (all pushed, all live on prod)

| Commit | What |
| --- | --- |
| `5ed8215` | Altana bounty evidence: 4 scoped sessions granted on BSC testnet via `scripts/grant-demo-sessions.ts`, persisted to `sessions`, `/authority` lists them with tx links. Readiness gate `altana-sessions` added. |
| `c647e26` | `metric_values`: 1,701 values / 567 agents via `src/lib/metrics.ts`. Probe cron recomputes every batch; floor 20 probes enforced at write time. Agent card renders uptime/p50 with qualifiers or honest "insufficient". `/methodology` renders from the same registry. |
| `d557287` | `/o/[id]` opportunity detail page; category rows link through. Param arrives percent-encoded - decoded before matching. |
| `cbc026b` | Readiness classify gate measures truth (backlog 0 + 4 categories populated), not impossible `unclassified=0`. **24/24 gates pass.** |
| `b746e1c` | MEASUREMENTS.md regenerated + mojibake repaired; study sections dated as point-in-time. |
| `c7e6b9c` | Personas: `/api/agent/[persona]/{card,a2a}` for yield/grid/rebalance over `src/lib/personas.ts`. `bestSupplyApr` reads `getAllMarkets()` (hardcoded addresses matched zero markets) and filters <$50k liquidity, naming exclusions (vUST quotes 415% APR on $0 cash). Harness `resolveEndpoint` follows any JSON reply with a `url` field. HF task asks borrowing power when subject has no debt. |
| `d1ccb0f` | THE LESSON COMMIT. `parseAgentReply` in `src/lib/task-grade.ts` was left uncommitted while its importer shipped - Vercel build failed, local gates were green against a dirty tree. Before pushing: verify a CLEAN CHECKOUT compiles (see gotchas). |

Prod (`gebo-bsc.vercel.app`) serves everything above as of ~11:52 UTC today,
including the persona card routes (verified 200 + real A2A answers locally and
the yield card live).

## IMMEDIATE next steps (in order)

1. **Record advantage runs** — `npx tsx scripts/run-advantage.ts --record`. Writes attestations with both-arm durations and zero-cost notes (cost fields are set to "0"/"USD" deliberately - measured fact, not missing data).
2. **Category payload asymmetry** — `grid`/`rebalancing` share one PancakeSwap schema, `yield`/`health` share one Venus schema. Add category-specific fields per spec.
3. **Refresh testnet Altana sessions** — re-run `npx tsx scripts/grant-demo-sessions.ts` (testnet) before judging so `/authority` shows live sessions. Sessions expire ≤48h; readiness gate `altana-sessions` flips MISSING when they do.
4. **Detect emerging categories** — run `npx tsx scripts/emerging-categories.ts` (20 agents with skills match no rule).
5. **Verify ERC-8183 hire flow** — confirm `/a/{tokenId}/hire` completes escrow via Altana buyer SDK (personas already have A2A endpoints).

Mainnet Altana grants removed from blockers: testnet satisfies bounty; mainnet only if funds available.

## Gotchas hit this session (each cost real time)

- **Vercel builds fail on uncommitted imports.** Green local gates mean nothing
  on a dirty tree. Clean-checkout check that works:
  ```
  git worktree add $env:TEMP\gebo-check HEAD
  cmd /c mklink /J "$wt\node_modules" "<repo>\node_modules"
  npx tsc --noEmit -p "$wt\tsconfig.json"
  ```
  (Do NOT Push-Location into the worktree - PS 5.1 chokes on the `DEV~1.ZOR`
  short path. Use `-p` instead.)
- **The concurrent UI agent wipes/prunes node_modules mid-session.** dotenv/
  postgres/tsx vanished at one point; an interrupted reinstall corrupts the
  esbuild exe (spawn EFTYPE). Recovery that worked: purge `node_modules/@esbuild`,
  `node_modules/esbuild`, `.bin/esbuild*`, then `npm install`. Verify with
  `node -e "require('esbuild').transformSync('let a=1',{loader:'ts'})"`.
- `npx tsx` resolves from the npx cache (`C:\npm-cache\_npx\fd45a72a545557e9`),
  not node_modules - fine when project deps exist, misleading when they do not.
- Advantage harness structure: TASKS x agents loop in `run-advantage.ts`;
  manual arm runs FIRST because truth decides the question (`ManualResult.question`).
  HTML-as-result bug is fixed at `parseAgentReply` in task-grade.ts with tests.
- Registration repair MAP lives in `scripts/tmp-owners.ts` (token id -> persona).
