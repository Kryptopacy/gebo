# GEBO — Operations

Deployment, scheduling, verification and troubleshooting.

---

## 1. Deploy

The build has **no database dependency**. Every data page renders per request
(`force-dynamic`), so CI never needs `DATABASE_URL`. This was not free — an
earlier build prerendered against Supabase and failed with 60-second timeouts
per page. If you ever see that again, check nothing has been switched back to
`force-static` or ISR.

```bash
npx next build     # must pass locally before pushing
```

Environment variables required in the hosting platform:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Supabase **transaction pooler**, port `6543` |
| `CRON_SECRET` | yes | Long random string. Cron routes refuse to run without it. |
| `ADMIN_PASSWORD` | for `/admin` | Ops console gate; login refuses when unset |
| `NEXT_PUBLIC_SITE_URL` | recommended | Sets `metadataBase`; without it OG images resolve against localhost |
| `BSC_MAINNET_RPC` | optional | Defaults to a public node |
| `NEXT_PUBLIC_SUPABASE_URL` | optional | Only if a browser client is added later |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | optional | Publishable keys are safe to expose; secret keys are not |

**Never set a Supabase secret or `service_role` key as `NEXT_PUBLIC_*`.** Any
`NEXT_PUBLIC_` variable is shipped to the browser.

---

## 2. Database

Apply migrations in order. Every statement is `IF NOT EXISTS` or
`DROP … IF EXISTS`, so re-running is safe.

```bash
npx tsx scripts/migrate.ts
```

| Migration | Adds |
| --- | --- |
| `0001_init.sql` | Core tables, RLS on all, public read policies |
| `0002_census_stats.sql` | `census_stats` — the figures the site serves |
| `0003_registry_tokens.sql` | Thin per-token ledger + `refresh_census_stats()` |
| `0004_token_uri.sql` | Metadata pointer + resolver work queue |
| `0005_schedule.sql` | `pg_cron` + `pg_net`, Vault helpers, scheduled jobs |
| `0006_capability_text.sql` | `capability_doc` tsvector for search |
| `0007_schedule_classify.sql` | Classification cron + rules-fingerprint invalidation |
| `0008_attestations.sql` | Attestation ledger behind the evidence gate |
| `0009_taxonomy_growth.sql` | Emerging-category candidates |
| `0010_probe_daily_err_counts.sql` | Error-class counters per day |
| `0011_lock_down_definer_functions.sql` | Revoke `PUBLIC` execute on definer fns (see AGENTS.md §11) |
| `0012_pg_net_schema.sql` | Drop/recreate pg_net (non-relocatable) — run `verify:pgnet` after |
| `0013`/`0014_strip_mojibake*.sql` | Repair double-encoded text |
| `0015`/`0018`/`0022_regrant*.sql` | Session regrant schedules, extended through the judging window and Nov 5 |
| `0016_grid_record_schedule.sql` | Daily grid track-record refresh |
| `0017_verified_reviews.sql` | Verified reviews table (L1 amendment) |
| `0019`/`0020`/`0028_materialize*.sql` | Materialize cron (the frozen-layer fix), cadence settling |
| `0021_probes_raw_rotation.sql` | 48h rotation for the raw probe window |
| `0023_materialize_index.sql` | Materialize candidate lookup index |
| `0024_stats_refresh_selfguard.sql` | `refresh_census_stats` advisory lock + staleness gate |
| `0025`/`0026`/`0027_search*.sql` | Search indexes: match-predicate arms, skills trgm, probe lookup |
| `0029_registry_counts.sql` | One-row landing aggregate table, direct-SQL refresh every 15 min |
| `0030_reputation_cron.sql` | Scheduled ERC-8004 reputation write-back (6h) |
| `0031_space_surgery.sql` | Free-tier reclaim: dead indexes, token_uri cache nulling, `gebo-maint` |
| `0032`/`0033_capability*.sql` | Expression index replacing the stored tsvector; column drop (apply 0033 only after the expression code is deployed — see AGENTS.md) |
| `0034_session_index.sql` | Keystore log indexing → third-party sessions |
| `0035_opportunity_fields.sql` | `pool_tick_snapshots` + snapshot retention |
| `0036_paper_mode.sql` | `paper_runs` / `paper_decisions` + daily paper cron |
| `0037_cron_cadence.sql` | The free-tier cadence relaxations |
| `0038_fleet_guard.sql` | Self-shedding load guard (see §3.1) |
| `0039_admin_cron_control.sql` | `admin_paused_jobs` + guard defers to admin pauses (see §3.2) |

### Why two agent tables

`registry_tokens` is a narrow ledger for **every** identity in the registry —
seven small columns, so the funnel is a live SQL aggregate rather than a
transcribed constant. `agents` holds rich rows only for the endpoint-bearing
minority that is actually browsable. Storing rich rows for all of them would
consume most of a 500 MB tier to display records nobody can hire.

### Storage budget

Probe history is deliberately **not** row-per-probe. At a 15-minute cadence
across the callable set that would be roughly 1.75M rows and ~306 MB per day,
exhausting the free tier in under two days. Instead:

- `probe_daily` — one row per endpoint per day, with counters and percentiles
- `probe_events` — state transitions only, because a change is news and an
  unchanged state is not
- `probes_raw` — short debugging window

---

## 3. Scheduler

Scheduling runs **inside Postgres** via `pg_cron`, which calls the app's own
routes through `pg_net`.

Why not the obvious options: GitHub Actions could not execute (account billing
lock), and Vercel's Hobby tier caps cron at once per day — useless for a
five-minute probe cadence or a six-figure resolution backlog. `pg_cron` runs
every minute, costs nothing on the free tier, and keeps the schedule beside the
data it maintains. The GitHub workflows remain in `.github/workflows/` as an
alternative if billing is restored; `refresh-measurements.yml` (daily docs
refresh) also depends on Actions actually executing — if it does not run, the
readiness freshness gate fails loudly rather than letting the published
figures drift silently.

### One-time setup, after deploying

Run in the Supabase SQL editor. Secrets live in Vault, so the bearer token is
not readable from `cron.job` or from source control.

```sql
select vault.create_secret('https://your-app.vercel.app', 'gebo_site_url');
select vault.create_secret('<same value as CRON_SECRET>',  'gebo_cron_secret');
```

Until both exist, `gebo_run_cron()` logs a warning and returns — the jobs run on
schedule but deliberately no-op. That is the designed state before deployment,
not a fault.

### Jobs (the sustainable free-tier fleet)

The full fleet does **not** fit the Supabase free tier at 257k+ agents —
measured twice on 2026-09-08, when the database throttled under the
every-minute fleet (see §5). The current configuration, applied by
`scripts/tmp-thin-fleet.ts`:

| Job | Cadence | Work |
| --- | --- | --- |
| `gebo-resolve` | every 5 min | Remote registration backlog, bounded slice |
| `gebo-materialize` | every 5 min | Census → `agents` (the frozen-layer fix) |
| `gebo-probe` | every 10 min | A2A/MCP handshakes for endpoints past `next_probe_at` |
| `gebo-sync` | every 15 min | New identities above the stored high-water mark |
| `gebo-counts` | every 30 min | `refresh_registry_counts()` — direct SQL, no HTTP hop |
| `gebo-maint` | hourly :23 | token_uri cache nulling, cron history retention, snapshot retention |
| `gebo-guard` | every 10 min | The fleet guard (§3.1) — direct SQL |
| `gebo-opportunities` | every 30 min | PancakeSwap V3 ticks + snapshots, Venus rates + oracle fields — the bonus job the guard manages |
| `gebo-paper` | daily 03:13 | Zero-spend decision loop, recorded + scored |
| `gebo-emerging` | daily 03:17 | Emerging-category candidates |
| `gebo-grid-record` | daily 07:17 | Replay-measured grid track record |
| `gebo-reputation` | every 6 h | ERC-8004 reputation write-back, gated |
| `gebo-probes-rotate` | hourly :17 | 48h raw-probe window rotation |
| `gebo-regrant-*` | daily/monthly | Demo session regrants through the judging window |
| *off (free-tier budget)* | — | `gebo-classify`, `gebo-sessions` — staleness disclosed wherever their data renders |

The full-fleet values remain in git history; restore them only when the
tier (or Pro) can carry the load.

Probe cadence is tiered by last outcome, so a run only touches what is due:

| Tier | Last result | Re-probed after |
| --- | --- | --- |
| 0 | validated | 15 minutes |
| 1 | responded | 6 hours |
| 2 | failed | 3 days |
| 3 | fatal lint defect | never — a broken URL cannot improve |

### Verify

```bash
npx tsx scripts/cron-status.ts
```

Reports installed extensions, whether each Vault secret is present, the
registered jobs, recent run history, and `pg_net` response codes for the last
hour. `succeeded` in `cron.job_run_details` means the *scheduler* fired; check
the pg_net status codes to confirm the endpoint actually answered.

```bash
npx tsx scripts/show-stats.ts     # the figures the site is currently serving
```

### 3.1 The fleet guard (`gebo-guard`, migration 0038)

The free tier throttles under sustained load, and a throttle at 3am with
nobody at the console is hours of degraded site. The guard is pure direct
SQL every 10 minutes — no HTTP hop, so it always runs:

- **Measures** in-database latency (an index-probe count: 13-858ms healthy,
  multiple seconds throttled — cold-connection spikes do not reach it).
- **Sheds** the bonus job (`gebo-opportunities`) after 2 consecutive
  checks ≥ 2000ms; **panic-sheds** `gebo-materialize`/`gebo-probe`/
  `gebo-sync` at ≥ 15000ms (the same stand-down that recovered both
  2026-09-08 incidents).
- **Restores** the bonus job after 6 consecutive healthy checks (~1h) —
  **unless an admin paused it** (§3.2: a human pause always wins).
- The floor fleet (`gebo-resolve`, `gebo-counts`, `gebo-maint`, dailies)
  never sheds.

Both branches have been verified against the live system, including a
deterministic restore test (the original thresholds sat below the
database's own healthy variance and would have starved the restore —
found by test, fixed same day). The guard's state is readable in
`public.fleet_guard`.

### 3.2 The ops console (`/admin`)

Browser access to everything this page describes, gated by
`ADMIN_PASSWORD` (single-admin, HMAC session cookie; login refuses rather
than defaulting open when the password is unset):

- **Panels**: pipeline lag, scheduled jobs with run history and pg_net
  response codes, database headroom vs the 500 MB tier, funnel,
  classification — the same truth `npm run readiness` reports, measured
  on request, auto-refreshing every 60s.
- **Run**: per-job run buttons. HTTP jobs call their cron route with the
  server-held `CRON_SECRET` (the same call pg_net makes); the direct-SQL
  jobs (`counts`, `maint`, `guard`) execute their SQL functions directly.
- **Pause / resume**: pause captures the job's full definition from
  `cron.job` into `admin_paused_jobs` before unscheduling, so resume is
  exact. The fleet guard checks `admin_paused_jobs` before auto-restoring
  — a deliberate admin pause is never silently undone by the automation.
- The shell scripts (`tmp-stand-down.ts`, `tmp-restore-crons.ts`,
  `tmp-thin-fleet.ts`) remain for bulk operations; the console covers
  single-job control.

---

## 4. Manual operations

Everything the scheduler does can be run by hand. Useful for backfills and for
work too long for a request handler.

```bash
# Seed registry_tokens from an existing local census
npx tsx scripts/sync-registry.ts --backfill

# Incremental chain read
npx tsx scripts/sync-registry.ts

# Work the resolution backlog harder than the cron slice
npx tsx scripts/resolve-pending.ts --limit 20000

# Full capped probe sweep, ignoring next_probe_at
npx tsx scripts/probe-agents.ts

# Reindex opportunity surfaces
npx tsx scripts/index-opportunities.ts
```

### Per-operator probe cap

`probe-agents.ts` probes at most `PER_OPERATOR_CAP` (default 60) agents per
operator. Endpoint concentration is extreme — a single operator holds tens of
thousands of identities — so probing all of them would spend hours hammering one
host to establish one fact. Operators below the cap are probed exhaustively,
which is nearly all of them. **The cap is disclosed in the UI**; an undisclosed
sample presented as a census would be precisely the dishonesty this project
exists to expose.

### Per-host pacing

Both the resolver and the prober pace requests per host. One operator accounts
for the large majority of metadata URLs, so an unpaced run would resemble a
denial-of-service attempt against a single origin.

---

## 5. Troubleshooting

**"prepared statement already exists", intermittently**
`DATABASE_URL` points at the direct connection (`5432`) instead of the
transaction pooler (`6543`), or `prepare: false` was dropped. `src/db/index.ts`
warns on `:5432`.

**`invalid byte sequence for encoding "UTF8": 0x00`**
A registration file contains NUL bytes. All untrusted strings must pass through
the `clean()` helper before insertion. Registration files are attacker-controlled.

**`Request exceeds defined limit` from an RPC**
Public BSC nodes cap `eth_getLogs` at roughly 1,000 blocks. The Keystore scanner
halves its span adaptively; do not raise the starting span.

**Build fails with a prerender timeout**
A page has been switched away from `force-dynamic` and is now querying Supabase
during the build.

**Free-tier throttling** (measured twice, 2026-09-08)
Symptoms: `select 1` takes 6-8s, ordinary queries die with statement
timeouts, cron responses go mostly `null` — with **zero blocked locks**
(pure CPU contention, not a locking bug). Playbook: stand the minute fleet
down (`scripts/tmp-stand-down.ts` or pause from `/admin`), wait ~40
minutes, verify `select 1` AND a real count query both return fast, then
restore with `scripts/tmp-restore-crons.ts` (full fleet) or
`scripts/tmp-thin-fleet.ts` (sustainable fleet). The guard (§3.1) now
does this automatically for its managed jobs.

**Cron jobs `succeeded` but nothing changes**
Expected before deployment — the Vault secrets are missing, so `gebo_run_cron()`
warns and returns. Confirm with `cron-status.ts`; `gebo_site_url` and
`gebo_cron_secret` will show `MISSING`.

**Free-tier project pausing**
Supabase pauses free projects after 7 days of inactivity. The scheduler queries
the database every minute, so the clock never reaches 7 days while cron is
active.

---

## 6. Known operational limits

- **Single-region probing.** One vantage point. An agent that geo-blocks or
  ASN-blocks us appears dead, and we cannot distinguish "down" from "unreachable
  from here". Disclosed on `/methodology`.
- **Remote resolution is incomplete** while the backlog drains, so
  endpoint-bearing and callable counts are lower bounds that rise over time.
- **No automated backups on the free tier.** Everything is reproducible from
  chain, but the probe history is not.
- **No error monitoring.** Failures surface only in platform logs and
  `cron.job_run_details`.

### Verification commands

- `npm run readiness` — 31 gates measured from the database and filesystem;
  includes a freshness gate on the docs/MEASUREMENTS.md generated block.
- `npm run verify:prod` — checks the deployed host actually serves.
- `npm run verify:pgnet` — queues a real pg_net request and waits for the
  response; the only trustworthy check after touching pg_net (a dead worker
  leaves every job reporting `succeeded` while nothing is fetched).
- `npm run verify` — `tsc --noEmit && vitest run && next build`; 268 tests.

**After any push** (deploys are automatic): verify the *deployed* content,
not the build log — probe a fingerprint like `/llms.txt`. A green local
verify on a dirty tree proves nothing about what was pushed: staged-then-
deleted files once failed every Vercel build for hours while local stayed
green (AGENTS.md, 2026-09-08).
