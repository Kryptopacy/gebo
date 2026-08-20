-- GEBO — schema for Supabase (managed Postgres).
--
-- RLS is enabled on every table because they live in the `public` schema, which
-- is exposed through the Data API. Per Supabase guidance, tables in an exposed
-- schema must have RLS enabled or they are reachable by the anon role.
--
-- The access model here is deliberate: this registry's whole argument is that
-- verification data should be readable by the ecosystem rather than locked in
-- one vendor's database. So anon gets SELECT on the measurement tables, and
-- writes are restricted to the service role used by the ingest/probe worker.
--
-- Apply with:  supabase db query < supabase/migrations/0001_init.sql
--          or: psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql

-- ── operators ──────────────────────────────────────────────────────────────
create table if not exists public.operators (
  key                 text primary key,
  kind                text not null,
  registrable_domain  text,
  label               text not null,
  agent_count         integer not null default 0,
  validated_count     integer not null default 0,
  fatal_defect_count  integer not null default 0,
  first_seen_at       timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists operators_agent_count_idx on public.operators (agent_count desc);

-- ── agents ─────────────────────────────────────────────────────────────────
create table if not exists public.agents (
  chain_id                integer not null,
  token_id                bigint  not null,
  registry                text    not null,
  agent_id                text    not null,
  owner                   text,
  agent_wallet            text,
  agent_wallet_verified   boolean default false,
  token_uri               text,
  uri_scheme              text,
  registration_json       jsonb,
  registration_resolved   boolean default false,
  registration_error      text,
  name                    text,
  description             text,
  protocols               text[],
  x402_supported          boolean default false,
  supported_trust         text[],
  self_declared_active    boolean,
  operator_key            text references public.operators (key),
  trust_state             text not null default 'DORMANT',
  trust_reason            text,
  category                text,
  category_matched        text[],
  lint_usable             boolean default false,
  lint_defects            jsonb,
  registered_at           timestamptz,
  first_seen_at           timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  primary key (chain_id, token_id)
);
create unique index if not exists agents_agent_id_idx    on public.agents (agent_id);
create index        if not exists agents_trust_state_idx on public.agents (trust_state);
create index        if not exists agents_category_idx    on public.agents (category);
create index        if not exists agents_operator_idx    on public.agents (operator_key);
create index        if not exists agents_uri_scheme_idx  on public.agents (uri_scheme);

-- ── endpoints ──────────────────────────────────────────────────────────────
create table if not exists public.agent_endpoints (
  id              bigint generated always as identity primary key,
  chain_id        integer not null,
  token_id        bigint  not null,
  kind            text    not null,
  url             text    not null,
  version         text,
  host            text,
  domain_verified boolean default false,
  probe_tier      smallint not null default 1,
  next_probe_at   timestamptz default now()
);
create index if not exists agent_endpoints_agent_idx      on public.agent_endpoints (chain_id, token_id);
create index if not exists agent_endpoints_next_probe_idx on public.agent_endpoints (next_probe_at, probe_tier);
create index if not exists agent_endpoints_host_idx       on public.agent_endpoints (host);

-- ── probe_daily ────────────────────────────────────────────────────────────
-- One row per endpoint per day. Raw probes are NOT stored long-term: at a
-- 15-minute cadence across ~18k callable agents that is ~1.75M rows/day
-- (~306 MB), which exhausts a 500 MB tier in under two days.
create table if not exists public.probe_daily (
  endpoint_id      bigint not null,
  day              date   not null,
  probes           integer not null default 0,
  ok_count         integer not null default 0,
  validated_count  integer not null default 0,
  p50_ms           integer,
  p95_ms           integer,
  fail_streak      integer not null default 0,
  last_ok_at       timestamptz,
  err_counts       jsonb,
  primary key (endpoint_id, day)
);
create index if not exists probe_daily_day_idx on public.probe_daily (day desc);

-- ── probe_events: transitions only ─────────────────────────────────────────
create table if not exists public.probe_events (
  id          bigint generated always as identity primary key,
  endpoint_id bigint not null,
  at          timestamptz not null default now(),
  from_grade  text,
  to_grade    text not null,
  http_status integer,
  err_class   text,
  detail      text
);
create index if not exists probe_events_endpoint_idx on public.probe_events (endpoint_id, at desc);

-- ── probes_raw: 48h debugging window ───────────────────────────────────────
create table if not exists public.probes_raw (
  id          bigint generated always as identity primary key,
  endpoint_id bigint not null,
  at          timestamptz not null default now(),
  grade       text not null,
  http_status integer,
  rtt_ms      integer,
  err_class   text,
  evidence    jsonb
);
create index if not exists probes_raw_at_idx on public.probes_raw (at desc);

-- ── reputation write-backs ─────────────────────────────────────────────────
create table if not exists public.reputation_writes (
  id              bigint generated always as identity primary key,
  chain_id        integer not null,
  token_id        bigint  not null,
  tag1            text    not null,
  value           integer not null,
  value_decimals  smallint not null,
  feedback_uri    text,
  tx_hash         text,
  written_at      timestamptz not null default now()
);
create index if not exists reputation_writes_agent_idx on public.reputation_writes (chain_id, token_id);

create table if not exists public.reviewers (
  address text primary key,
  trusted boolean not null default false,
  note    text
);

-- ── opportunities ──────────────────────────────────────────────────────────
create table if not exists public.opportunities (
  id                text primary key,
  category          text not null,
  chain_id          integer not null,
  venue             text not null,
  ref               text not null,
  label             text not null,
  payload           jsonb not null,
  eligible          boolean not null default true,
  ineligible_reason text,
  updated_at        timestamptz not null default now()
);
create index if not exists opportunities_category_idx on public.opportunities (category, eligible);
create index if not exists opportunities_updated_idx  on public.opportunities (updated_at desc);

-- ── sessions (blast radius) ────────────────────────────────────────────────
create table if not exists public.sessions (
  id                  bigint generated always as identity primary key,
  chain_id            integer not null,
  wallet_address      text not null,
  session_public_key  text not null,
  canonical_json      text not null,
  state               text not null default 'active',
  expiry              timestamptz,
  unbounded           boolean not null default false,
  call_allowlist      jsonb,
  spend_caps          jsonb,
  grant_tx_hash       text,
  revoke_tx_hash      text,
  observed_at         timestamptz not null default now()
);
create unique index if not exists sessions_key_idx       on public.sessions (chain_id, session_public_key);
create index        if not exists sessions_wallet_idx    on public.sessions (wallet_address);
create index        if not exists sessions_unbounded_idx on public.sessions (unbounded);

-- ── metric values ──────────────────────────────────────────────────────────
-- qualifiers is NOT NULL by design: a value may never travel without its
-- denominator, window, cost treatment and observation count.
create table if not exists public.metric_values (
  id          bigint generated always as identity primary key,
  chain_id    integer not null,
  token_id    bigint  not null,
  metric_id   text    not null,
  -- "window" is a reserved word in Postgres and must stay quoted.
  "window"    text    not null,
  value       real,
  obs_count   integer not null,
  qualifiers  jsonb   not null,
  computed_at timestamptz not null default now()
);
create unique index if not exists metric_values_unique_idx
  on public.metric_values (chain_id, token_id, metric_id, "window");

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Enabled on every table. Public SELECT is intentional: publishing our own
-- measurements is the point. All writes go through the service role, which
-- bypasses RLS.
do $$
declare t text;
begin
  foreach t in array array[
    'operators','agents','agent_endpoints','probe_daily','probe_events',
    'probes_raw','reputation_writes','reviewers','opportunities','sessions',
    'metric_values'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_public_read', t
    );
  end loop;
end $$;
