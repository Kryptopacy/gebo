-- GEBO 0029 - registry_counts: landing aggregates from a one-row table.
--
-- The landing page's aggregate read (one statement over agents + operators)
-- measured 9.8s COLD against its 9s render timeout on 2026-09-07: after a
-- pooler plan eviction, every first-time visitor re-paid the full
-- aggregation and got the invariant-9 "could not be measured" banner. That
-- banner is for failed measurements, not for the default state of the
-- headline numbers (PRODUCT_SPEC: the trust counter is the entire
-- differentiation, above the fold). Warm, the same query ran ~1s - the
-- defect was specifically the cold path every new visitor takes.
--
-- A plain table, not a materialized view: REFRESH VIEW takes locks that
-- complicate the pooler story, and the upsert-on-conflict pattern already
-- exists (census_stats + refresh_census_stats, 0002/0003/0024). Refreshed
-- by DIRECT pg_cron SQL every 5 minutes - no HTTP hop, so unlike the pg_net
-- routes a "succeeded" cron run really ran (the 0024 bug hid for 6 hours
-- precisely because queueing an HTTP request is not executing it).
--
-- The read side (src/lib/data.ts loadAggregates) treats the row as
-- authoritative only while fresh (30 min = six missed runs); a stale or
-- missing row falls back to the direct query, and a failed direct query
-- still renders the honest banner. A failed measurement never renders as
-- zero, and a stale one never renders as current.
create table if not exists public.registry_counts (
  id             text primary key default 'bsc',
  agents         integer not null,
  states         jsonb   not null,
  categories     jsonb   not null,
  operators      integer not null,
  top_operators  jsonb   not null,
  computed_at    timestamptz not null default now()
);

alter table public.registry_counts enable row level security;
drop policy if exists registry_counts_public_read on public.registry_counts;
create policy registry_counts_public_read on public.registry_counts
  for select to anon, authenticated using (true);

-- Columns: 7. Select expressions: 7. (0024 shipped 27 into 25 and every
-- cron pass 500'd for six hours; count them, every time.)
create or replace function public.refresh_registry_counts()
returns void
language sql
security invoker
set search_path = public
as $$
  insert into registry_counts as rc (id, agents, states, categories, operators, top_operators, computed_at)
  select
    'bsc',
    (select count(*)::int from agents where chain_id = 56),
    (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) from (
       select trust_state as state, count(*)::int as n
       from agents where chain_id = 56 group by trust_state) s),
    (select coalesce(jsonb_object_agg(category, n), '{}'::jsonb) from (
       select category, count(*)::int as n
       from agents where chain_id = 56 and category is not null group by category) c),
    (select count(*)::int from operators where agent_count > 0),
    (select coalesce(jsonb_agg(to_jsonb(o) order by o.agent_count desc), '[]'::jsonb) from (
       select key, label, agent_count, validated_count, fatal_defect_count
       from operators where agent_count > 0
       order by agent_count desc limit 10) o),
    now()
  on conflict (id) do update set
    agents = excluded.agents,
    states = excluded.states,
    categories = excluded.categories,
    operators = excluded.operators,
    top_operators = excluded.top_operators,
    computed_at = excluded.computed_at;
$$;

-- Invoker function, but not callable by the world: an anon caller through
-- PostgREST could otherwise force the ~1-10s aggregation on demand (0011
-- established the pattern - revoke from PUBLIC, grant to postgres).
revoke all on function public.refresh_registry_counts() from public, anon, authenticated;
grant execute on function public.refresh_registry_counts() to postgres;

select cron.schedule('gebo-counts', '*/5 * * * *',
  $$select public.refresh_registry_counts()$$);

-- Seed now, so the first request after this migration serves from the table
-- rather than paying the cold aggregation itself.
select public.refresh_registry_counts();
