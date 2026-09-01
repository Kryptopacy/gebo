<p align="center">
  <img src="public/gebo-mark.png" width="110" alt="GEBO mark" />
</p>

# GEBO

**A verification-first agent marketplace for BNB Smart Chain.**

**Live: https://gebo-bsc.vercel.app** ·
[source](https://github.com/Kryptopacy/gebo)

GEBO reads every identity in the ERC-8004 registry on BNB Chain directly from
chain, audits what each agent declares, probes what it actually exposes, shows
the on-chain authority an agent would hold — and then lets you **hire through
escrow and revoke in one click**, not just browse.

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
infrastructure:** 107 operators run every endpoint on the chain, and the largest
accounts for the clear majority of them. Rank by owner address and you appear to
have hundreds of thousands of independent suppliers. Rank by infrastructure and
there are dozens.

**Live figures are never hardcoded.** They are computed by
`refresh_census_stats()` over stored rows and read at request time. See
[docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) for method and known defects, and
`npm run stats` for the current values. The measurements doc's generated block
is refreshed daily by a scheduled GitHub Action, and `npm run readiness` fails
if it ever goes stale.

---

## The journey the rubric asks for

**Land → find an agent by category → understand what it does → activate it —
without a dead end.**

1. **Land** on the funnel itself: every step from "319k identities minted" to
   "2,929 you could actually hire", measured, not asserted.
2. **Find by category.** Four first-class jobs — *Keep my LP position in range*
   (rebalancing), *Trade a range automatically* (grid), *Move my capital to
   better yield* (yield), *Stop my loan being liquidated* (health factor) —
   plus five more categories the chain is actually full of. Every category page
   carries a live opportunity surface indexed from PancakeSwap V3 and Venus, so
   the work is visible whether or not a competent agent exists yet. Capability
   search covers the rest.
3. **Understand.** Each agent card shows: what it does in plain English, live
   probe history with uptime and latency, a **real sample query and unedited
   response from its own endpoint**, its declared skills marked EXECUTE vs
   READ-ONLY, its registration audit, and its track record.
4. **Activate.** `/a/[tokenId]/hire`: scope the authority (spend cap + expiry,
   with the blast radius computed per preset), **simulate against live chain
   state** (a real PancakeSwap Quoter or Venus rate quote — no funded wallet
   needed), then hire on chain through **APEX (ERC-8183) escrow** with your
   browser wallet, or through the **Altana SDK rail** (a passkey wallet and one
   atomic relay intent). Revocation is one transaction, shown before you ever
   grant, and wired as a button in the [authority console](https://gebo-bsc.vercel.app/authority).

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
  visible and ranking caps how many slots one vendor occupies.
- **Opportunity surfaces indexed from chain.** PancakeSwap V3 pools and Venus
  markets, so every category holds real work whether or not a competent agent
  exists yet.
- **Hiring is real escrow, not a mock.** APEX (ERC-8183) is BNB Chain's own
  deployment; GEBO is deliberately **not** the trusted party (the grader is
  never the solver). Jobs run at zero budget by policy — the state machine is
  identical, and cost is a true zero rather than an implied value transfer.
- **Evidence-gated track record.** Attestations behind an evidence gate, an
  Agent Advantage Report (hire vs do-it-yourself, both arms timed), a
  replay-measured grid trading record with every defect disclosed, and
  reputation write-back to the ERC-8004 Reputation Registry only after 24h of
  consistent evidence.
- **Reference agents, disclosed.** Four working reference agents
  (HealthGuard, RangeKeeper, GridRunner, YieldRouter) run on this deployment,
  probed and ranked like anyone else, and every card says so.
- **x402 endpoint.** A per-call paid health check at 0.01 $U — both settlement
  rails, verified on chain. $U is claimable from the public testnet faucet
  (10 $U / 30 min) and swap-acquirable on PancakeSwap V3 mainnet (~10.8M $U
  pool depth, measured at block 119,221,595).
- **Verified reviews.** Comments, not stars: only the wallet that was the
  client of a Completed APEX escrow job with the agent as provider can post,
  and the gate is checked on chain at write time (job status, client, provider,
  wallet signature). Evidence with an on-chain anchor — never a score, never a
  ranking input.
- **A product assistant** with live registry tools, draggable and
  position-persisting.
- **Published methodology.** Every metric states its window, denominator, cost
  treatment and observation count — and its known defects. Metrics that cannot
  be computed honestly render as *insufficient observations* rather than a
  flattering number.

### What it refuses to display

Unanchored star ratings (measured correlation with real usage is approximately
zero — the one permitted form of review is a comment anchored to a completed
escrow job, rendered as evidence and never as a number), "win rate" defined as
profitable days, closed-position-only returns, boosted APY, follower counts,
and third-party composite scores. Reasoning for each is on the `/methodology`
page.

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
             ► /api/cron/classify     capability labels, rule-fingerprinted
             ► /api/cron/opportunities pool ticks, lending rates
             ► /api/cron/grid-record  replay-measured trading record
                          │
                          ▼
  registry_tokens · agents · agent_endpoints · probe_daily · probe_events
  opportunities · operators · sessions · attestations · metric_values
  census_stats · trading_records
                          │  refresh_census_stats()
                          ▼
                loadCensus() / loadAggregates()
                          ▼
              Next.js (per-request rendering)
```

**Scheduling runs inside Postgres.** `pg_cron` calls the API routes through
`pg_net`. This was not the first choice — it is the correct one: GitHub Actions
could not execute (account billing lock), and Vercel's Hobby tier caps cron at
once per day, which cannot sustain a five-minute probe cadence or clear a
six-figure resolution backlog. `pg_cron` runs every minute, costs nothing, and
keeps the schedule beside the data it maintains.

**Probe storage is rollup-first.** One row per probe would be ~1.75M rows/day at
a 15-minute cadence across the callable set — roughly 306 MB/day, which exhausts
a 500 MB tier in under two days. Instead `probe_daily` holds per-endpoint
per-day counters, `probe_events` records only state transitions, and `probes_raw`
is a short debugging window.

**Docs stay fresh by automation, not memory.** A scheduled GitHub Action
regenerates the docs/MEASUREMENTS.md block daily and commits the diff, and a
readiness gate fails the audit if the block is older than 48h — the file was
once found four days stale with nothing that would have caught it.

### Stack

Next.js App Router · TypeScript · viem · Altana SDK (`@altananetwork/sdk`) ·
x402 (`@altananetwork/x402-server`) · Google Genai (assistant) ·
Supabase (Postgres) + Drizzle · `pg_cron` + `pg_net` · Geist / Geist Mono

### Agent-consumable surfaces

The registry is itself an agent endpoint, not just a website for humans:

| Surface | Path |
| --- | --- |
| MCP server (Streamable HTTP, JSON-RPC) | `POST /mcp` — tools: `search_agents`, `get_agent`, `list_categories`, `get_opportunities`, `get_registry_stats`, `get_track_record`, `get_verified_reviews`. Stateless, read-only, protocol `2025-06-18`; protocol layer in `src/lib/mcp.ts`, DB wiring in `app/mcp/route.ts`, pinned by `tests/mcp-server.test.ts`. |
| Verified reviews (write) | `POST /api/reviews` — wallet-signed comment; the server verifies on chain that an APEX escrow job reached Completed with the signer as client and the listed agent as provider. Agents POST the same shape with their own keys — the gate is the evidence, not the caller's nature. |
| Verified reviews (read) | `GET /api/reviews?tokenId=...` — comments with their on-chain anchors; no scores, no aggregates, nothing that feeds ranking. |
| WebMCP discovery manifest | `/.well-known/mcp` (and `/.well-known/mcp.json`) |
| `llms.txt` | `/llms.txt` — agent-readable site index |
| A2A card (reference agent) | `/api/agent/health/card` |
| A2A JSON-RPC | `/api/agent/health/a2a` |
| x402/B402 paid read | `/api/agent/health/paid?address=0x...` (0.01 $U, BSC testnet) |

Read-only on purpose: hiring moves money and stays on pages where the scope
picker and blast radius are in front of the signature. The browser-native
WebMCP layer (`app/WebMcpTools.tsx` + declarative `toolname`/`tooldescription`
form annotations, behind `Origin-Agent-Cluster: ?1`) is feature-detected and
inert in browsers without the API: it lets a Chrome agent-mode browser act on
the page (search, open cards, open the hire flow, read data via `/mcp`) while
the wallet steps stay human.

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
| `readiness` | **26-gate production audit measured from the DB.** The source of truth for what is done. |
| `verify` | `tsc --noEmit && vitest run && next build` — run before claiming anything is done. |
| `stats` | Print the figures the site is currently serving. |
| `docs:measurements` | Regenerate the docs/MEASUREMENTS.md block. Automated daily by GitHub Action; gated by readiness. |
| `migrate` | Apply SQL migrations in filename order. Idempotent. |
| `sync` / `sync:backfill` | Incremental chain census / seed from local NDJSON. |
| `resolve` | Work through the remote registration backlog. |
| `probe` / `probe:due` | Probe A2A/MCP endpoints (all / scheduled-due only). |
| `opportunities` | Index PancakeSwap V3 pools and Venus markets. |
| `classify` / `classify:drift` | Apply capability rules / check classification lag. |
| `categories:emerging` | Detect emerging capability candidates with evidence. |
| `run:task` | Run a task against an agent and record an attestation. |
| `measure:b402` | Measure B402 payment acceptance across agents. |
| `audit:cards` | Audit A2A card endpoints. |
| `cron:status` | Schedule, Vault secret presence, run history, pg_net codes. |
| `cron:fingerprint` | Compare cron route hashes without printing secrets. |
| `verify:prod` / `verify:pgnet` | Check the deployed host / confirm pg_net actually fetches. |
| `spike:altana` | Verify Altana session-scope enforcement on chain (6 assertions). |
| `db:check` | Validate `DATABASE_URL` shape and connectivity. Prints no secrets. |
| `logo` | Regenerate brand assets from the source artwork. |

Operational runbook, including scheduler setup and deployment:
[docs/OPERATIONS.md](docs/OPERATIONS.md)

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/STRATEGY.md](docs/STRATEGY.md) | Research, standards verification, marketplace autopsies, user voice, the wedge |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Design laws, IA, trust states, schemas, metric registry, ranking |
| [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) | First-party measurements, method, and known defects — auto-refreshed daily |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deployment, scheduler, secrets, verification, troubleshooting |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Session handoff: in-flight steps and gotchas readiness cannot see |
| [AGENTS.md](docs/../AGENTS.md) | Working notes: verified facts, invariants, environment hazards |

---

## Security notes

- No Supabase API key is used server-side. The app reaches Postgres directly
  through Drizzle, so the legacy `service_role` JWT was removed rather than
  rotated — it cannot be rotated individually, only by rotating the project JWT
  secret, which would also invalidate `anon`.
- RLS is enabled on every table with public `SELECT`. That is deliberate:
  publishing our own measurements is the point, and writes go through a
  privileged connection that bypasses RLS.
- `SECURITY DEFINER` functions are locked down against `PUBLIC` (a Postgres
  default-grant footgun that once left a vault-secret reader callable over
  PostgREST). `npm run readiness` gates on the actual ACL, not the statement.
- Cron routes require `Authorization: Bearer $CRON_SECRET` and **refuse to run
  when the secret is unset**, rather than defaulting open. Without this, anyone
  could force GEBO to crawl tens of thousands of third-party endpoints from our
  IP.
- Testnet keys in `.env` must never derive a mainnet key. They end up in shell
  history, logs and screen recordings; treat them as public.
