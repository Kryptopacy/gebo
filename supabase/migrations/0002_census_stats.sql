-- GEBO 0002 — census statistics.
--
-- Why this table exists: the funnel figures were previously hardcoded in the
-- CENSUS constant, the page headline, and the page metadata. Any re-run of the
-- census would leave three copies to hand-edit, and the site would present
-- stale numbers in the meantime — unacceptable for a product whose claim is
-- that its figures are measured rather than asserted.
--
-- scripts/analyse-census.ts writes exactly one row here, and the app reads it.
-- Single row enforced by a fixed primary key.

create table if not exists public.census_stats (
  id                      text primary key default 'bsc',
  chain_id                integer not null default 56,
  registry                text,

  -- funnel, in narrowing order
  tokens_minted           bigint,
  censused                bigint,
  resolved                bigint,
  named                   bigint,
  claim_active            bigint,
  with_endpoint           bigint,
  callable                bigint,

  -- concentration
  operators               integer,
  owners                  bigint,
  owners_with_one_agent   bigint,
  largest_operator_share  numeric(6,2),
  top5_operator_share     numeric(6,2),
  top20_operator_share    numeric(6,2),
  top10_owner_share       numeric(6,2),

  -- declared characteristics
  declares_reputation     bigint,
  empty_token_uri         bigint,
  x402_supported          bigint,
  fatal_defects           bigint,

  -- distributions kept as jsonb so new keys need no migration
  uri_schemes             jsonb,
  endpoint_kinds          jsonb,
  trust_models            jsonb,
  top_operators           jsonb,

  measured_at             timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.census_stats enable row level security;
drop policy if exists census_stats_public_read on public.census_stats;
create policy census_stats_public_read on public.census_stats
  for select to anon, authenticated using (true);
