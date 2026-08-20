# GEBO

**A verification-first agent registry for BNB Smart Chain.**

GEBO reads every identity in the ERC-8004 registry on BNB Chain directly from
chain, audits what each agent declares, probes what it actually exposes, and
shows the on-chain authority an agent holds — before anyone grants it access to
a wallet.

The name is the Elder Futhark rune **ᚷ** (*gebo*): gift, and specifically
reciprocal exchange. A marketplace only deserves the word if both sides can see
what they are getting.

---

## The finding this exists to serve

BNB Chain hosts more registered AI agents than any other network. Almost none of
them can be hired.

| Stage | Source |
| --- | --- |
| Identities minted in the registry | read from `0x8004a169…a432` |
| Registration file resolvable | `data:` decoded inline, remote fetched |
| **Self-declare `"active": true`** | self-reported, unverified |
| **Publish any service endpoint** | A2A, MCP or web |
| **Callable and structurally sound** | declares A2A/MCP, survives lint |

The gap between the third and fourth rows is the product. **Around 150,000
identities declare themselves active while publishing no way to reach them.**
Every other directory repeats that claim; GEBO reports whether anything answers.

A second finding corrected an early assumption. Ownership is *not* concentrated —
the overwhelming majority of owner addresses hold exactly one identity, which is
the signature of points farming rather than supply. **Concentration lives in
infrastructure:** a double-digit number of operators run every endpoint on the
chain, and the largest accounts for the clear majority of them. Rank by owner
address and you appear to have hundreds of thousands of independent suppliers.
Rank by infrastructure and there are dozens.

**Live figures are never hardcoded.** They are computed by
`refresh_census_stats()` over stored rows and read at request time. See
[docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) for method and known defects, and
`npx tsx scripts/show-stats.ts` for the current values.

---

## What makes it different

- **Reads the registry directly.** Chain multicall at ~37 reads/sec, not a
  rate-limited third-party API. No single-vendor dependency.
- **Graded protocol probing.** An A2A endpoint must return a parseable Agent
  Card; an MCP endpoint must complete a JSON-RPC `initialize` handshake. A 200
  response proves a server exists, not that an agent does.
- **Registration linting.** Detects unsubstituted template placeholders
  (`/agents/{agentId}/card`), loopback and RFC-1918 hosts, bare IPs and
  placeholder domains. Defects are surfaced with the reason, never silently
  dropped.
- **Operator identity.** Derived from the endpoint host, so concentration is
  visible and ranking can cap how many slots one vendor occupies.
- **Opportunity surfaces indexed from chain.** PancakeSwap V3 pools and Venus
  markets, so every category holds real work whether or not a competent agent
  exists yet.
- **Published methodology.** Every metric states its window, denominator, cost
  treatment and observation count — and its known defects. Metrics that cannot
  be computed honestly render as *insufficient observations* rather than a
  flattering number.

### What it refuses to display

Star ratings (measured correlation with real usage is approximately zero),
"win rate" defined as profitable days, closed-position-only returns, boosted APY,
follower counts, and third-party composite scores. Reasoning for each is on the
`/methodology` page.

---

## Architecture

```
                    ERC-8004 Identity Registry (BSC)
                    PancakeSwap V3 · Venus
                              │  multicall reads
                              ▼
  pg_cron ──► /api/cron/sync          new identities, data: URIs inline
  (Supabase) ► /api/cron/resolve      remote registration backlog
             ► /api/cron/probe        A2A/MCP handshakes, tiered cadence
             ► /api/cron/opportunities pool ticks, lending rates
                              │
                              ▼
   registry_tokens · agents · agent_endpoints · probe_daily · probe_events
   opportunities · operators · sessions · census_stats
                              │  refresh_census_stats()
                              ▼
                    loadCensus() / loadAggregates()
                              ▼
                  Next.js (per-request rendering)
```

**Scheduling runs inside Postgres.** `pg_cron` calls the API routes through
`pg_net`. This was not the first choice — it is the correct one: GitHub Actions
was unavailable, and Vercel's Hobby tier caps cron at once per day, which cannot
sustain a five-minute probe cadence or clear a six-figure resolution backlog.
`pg_cron` runs every minute, costs nothing, and keeps the schedule beside the
data it maintains.

**Probe storage is rollup-first.** One row per probe would be ~1.75M rows/day at
a 15-minute cadence across the callable set — roughly 306 MB/day, which exhausts
a 500 MB tier in under two days. Instead `probe_daily` holds per-endpoint
per-day counters, `probe_events` records only state transitions, and `probes_raw`
is a short debugging window.

### Stack

Next.js App Router · TypeScript · viem · Supabase (Postgres) + Drizzle ·
`pg_cron` + `pg_net` · Geist / Geist Mono

---

## Running it

```bash
npm install
cp .env.example .env          # then fill DATABASE_URL and the rest
npx tsx scripts/migrate.ts    # apply supabase/migrations in order
npm run dev                   # http://localhost:3100
```

`DATABASE_URL` must be the Supabase **transaction-mode pooler** on port `6543`,
not the direct connection on `5432`. Transaction pooling does not support
prepared statements, so `postgres-js` is configured with `prepare: false`; the
symptom of getting this wrong is intermittent "prepared statement already
exists" errors that look like random flakiness.

The app runs without a database, falling back to local NDJSON and a typed
snapshot, so it is never hard-blocked on infrastructure.

### Scripts

| Script | Purpose |
| --- | --- |
| `migrate.ts` | Apply SQL migrations in filename order. Idempotent. |
| `sync-registry.ts` | Incremental chain census. `--backfill` seeds from local NDJSON. |
| `resolve-pending.ts` | Work through the remote registration backlog. |
| `probe-agents.ts` | Probe A2A/MCP endpoints. `--due` for scheduled runs. |
| `index-opportunities.ts` | Index PancakeSwap V3 pools and Venus markets. |
| `analyse-census.ts` | Analyse the NDJSON census and persist `census_stats`. |
| `show-stats.ts` | Print the figures the site is currently serving. |
| `cron-status.ts` | Schedule, Vault secret presence, run history, pg_net codes. |
| `db-check.ts` | Validate `DATABASE_URL` shape and connectivity. Prints no secrets. |
| `build-logo.ts` | Regenerate brand assets from the source artwork. |

Operational runbook, including scheduler setup and deployment:
[docs/OPERATIONS.md](docs/OPERATIONS.md)

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/STRATEGY.md](docs/STRATEGY.md) | Research, standards verification, marketplace autopsies, user voice, the wedge |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Design laws, IA, trust states, schemas, metric registry, ranking |
| [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) | First-party measurements, method, and known defects |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deployment, scheduler, secrets, verification, troubleshooting |

---

## Security notes

- No Supabase API key is used server-side. The app reaches Postgres directly
  through Drizzle, so the legacy `service_role` JWT was removed rather than
  rotated — it cannot be rotated individually, only by rotating the project JWT
  secret, which would also invalidate `anon`.
- RLS is enabled on every table with public `SELECT`. That is deliberate:
  publishing our own measurements is the point, and writes go through a
  privileged connection that bypasses RLS.
- Cron routes require `Authorization: Bearer $CRON_SECRET` and **refuse to run
  when the secret is unset**, rather than defaulting open. Without this, anyone
  could force GEBO to crawl tens of thousands of third-party endpoints from our
  IP.
- Testnet keys in `.env` must never derive a mainnet key. They end up in shell
  history, logs and screen recordings; treat them as public.
