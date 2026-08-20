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
| `0005_schedule.sql` | `pg_cron` + `pg_net`, Vault helpers, four scheduled jobs |

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
alternative if billing is restored.

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

### Jobs

| Job | Cadence | Work |
| --- | --- | --- |
| `gebo-resolve` | every minute | Remote registration backlog, bounded slice |
| `gebo-probe` | every 5 min | A2A/MCP handshakes for endpoints past `next_probe_at` |
| `gebo-sync` | every 5 min | New identities above the stored high-water mark |
| `gebo-opportunities` | every 10 min | PancakeSwap V3 ticks, Venus rates |

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
- **No tests.** The highest-value first targets are the `clean()` sanitiser, the
  spend-cap decimals helper, and `registrableDomain()`.
- **No error monitoring.** Failures surface only in platform logs and
  `cron.job_run_details`.
