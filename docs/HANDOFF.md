# Session handoff - 2026-08-26

Supplement to AGENTS.md, not a replacement. `npm run readiness` remains the source
of truth for what is DONE; this file records what readiness cannot see: in-flight
steps, session-specific gotchas, and the exact next actions.

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

1. **Registration repair** - run `npx tsx scripts/tmp-owners.ts` (UNCOMMITTED
   throwaway, by design). Repoints tokens 259573/259574/259575/259576 to
   `https://gebo-bsc.vercel.app/api/agent/{health,rebalance,grid,yield}/card`
   and sets probes due. Delete the script after it runs.
2. **Dry run**: `npx tsx scripts/run-advantage.ts`. Expect our four personas to
   answer; third-party agents likely fail/partial - that is honest evidence, not
   a problem to fix.
3. **Record**: same with `--record`. Writes attestations with both-arm durations
   and zero-cost notes (cost fields are set to "0"/"USD" deliberately - measured
   fact, not missing data).
4. Then the remaining contest gaps, biggest first:
   - Category payload asymmetry: grid/rebalancing share one PancakeSwap schema,
     yield/health share one Venus schema. Add category-specific fields per spec.
   - Mainnet Altana grants: fund DEMO key (~0.001 BNB), rerun
     `grant-demo-sessions.ts --mainnet`. Testnet satisfies the bounty; mainnet is stronger.
   - Sessions expire <=48h after granting -> readiness gate `altana-sessions`
     flips MISSING. Re-run the grant script to refresh; that is by design.

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
