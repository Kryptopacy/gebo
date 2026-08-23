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
npm run cron:status      # are the five scheduled jobs alive, and did they succeed
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

- **ERC-8183 exists** (Draft, 2026-02-25). Its reference implementation contradicts
  its own spec: `fund()` drops the `expectedBudget` front-running check while
  `setBudget` is provider-only, so a provider can raise the price and drain the
  client's allowance. Do not deploy that kernel.
- **x402 originated at Coinbase**, not Binance. "Binance x402" is their facilitator.
  Conflating them reads as shallow.
- BNB stablecoins are **18 decimals, not 6**. A decimals slip is a 10^12 spend-cap
  error. One helper constructs caps; it is property-tested across both.

## Invariants that must not be broken

These encode failures already made and corrected. Breaking one silently undoes
real work.

1. **No bare numbers in the UI.** A metric renders with denominator, window, cost
   treatment and observation count, or not at all. `metric_values.qualifiers` is
   `NOT NULL` to make this structural rather than a matter of discipline.
2. **Never rank by popularity.** GPT Store data measured Cor(usage, rating) at
   −0.153 to +0.071 — ratings carry no information. There are no star ratings here.
3. **Absence of evidence is never rendered as evidence of absence.** Any claim
   scoped to one data source must say so in the UI. `/authority` currently violates
   this and it is the highest-priority open bug.
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

A second agent (Antigravity IDE) works the UI in this same worktree. It owns
`app/globals.css`, `app/layout.tsx`, `app/page.tsx` and the visual layer generally.

Consequence to watch for: `src/lib/reputation.ts` and
`scripts/verify-reputation-registry.ts` were swept into that agent's UI commit
`5a0b46b` unverified, because they were sitting uncommitted when it staged
everything. **Commit your own work promptly**, and check `git log --stat` for a
commit whose message does not match its contents.

## What is deliberately not built

Recorded so nobody "fixes" a decision.

- **No star ratings, ever.** See invariant 2.
- **No unfiltered ERC-8004 aggregation.** The spec requires a non-empty
  `clientAddresses` filter on `getSummary` because otherwise it is Sybil-farmable.
  Competitors rendering aggregate scores are violating the standard they cite.
- **Categories are not auto-created from term frequency.** Measured: frequency
  nominated `unibase` (an operator) on 17 verified texts, `swan` and `black` from
  memecoin titles, and the function word `not`. Four candidates, four noise. The
  detector surfaces candidates with evidence; a person promotes.
- **Multi-region probing** is the production answer to invariant 8 and is deferred.
- **`pg_net` stays in the `public` schema.** The Supabase linter flags it, and it
  cannot be moved: `alter extension pg_net set schema extensions` fails with
  *"extension pg_net does not support SET SCHEMA"*. Measured before accepting: all
  15 objects pg_net owns live in the `net` schema and **none** are in `public`, so
  it exposes no callable surface there and the finding has no exploit path. The only
  remedy is drop-and-recreate, which would take `net.http_get` away from
  `gebo_run_cron` and stop all six cron jobs. Not worth it for a namespace nicety.
- **PancakeSwap Infinity** is live and now their lead product; V3 is the target for
  now, with Infinity in the roadmap.
- **Escrow only mechanically-verifiable work.** A research agent's output quality is
  not on-chain checkable; meter that per call via x402 instead of pretending to
  escrow it.

## Conventions

- Comments explain **why**, especially where a non-obvious choice encodes a bug
  already hit. Migrations carry the same standard.
- Every script prints what it measured, and says so when it cannot measure
  something rather than passing quietly.
- Never print a secret. `scripts/cron-fingerprint.ts` compares hashes because an
  earlier session leaked a live secret into a transcript.
- `npm run verify` = `tsc --noEmit && vitest run && next build`. Run it before
  claiming anything is done.
