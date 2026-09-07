-- GEBO 0031 - free-tier space surgery, second round.
--
-- 2026-09-06 ended at 201 MB; by 2026-09-07 evening the database is at
-- 503+ MB and Supabase flags it past the 500 MB free tier, with performance
-- affected. Growth attribution, measured (scripts/tmp-size-audit.ts):
--   * agents 273 MB - the backfill materialized ~69k more rows, each with
--     description (15.6 MB total), a stored capability_doc tsvector
--     (36.7 MB) and supported_trust (6.4 MB)
--   * registry_tokens 150 MB - of which token_uri cache is 67.3 MB
--   * 34 MB of agents indexes with zero scans over a long accumulation
--     window (the pkey shows 195M scans in the same window, so zero is
--     zero, not "recently reset")
--   * cron.job_run_details 8.8 MB - pg_cron keeps run history forever
--
-- This migration carries the schema-side cuts no deployed query depends on
-- (verified: grep finds no WHERE agent_id = / skills @> / agents.uri_scheme
-- filters; idx_scan = 0 on all three). The one-off mass operations - batched
-- token_uri nulling and VACUUM FULL - run in scripts/tmp-space-surgery.ts,
-- because VACUUM FULL through the TRANSACTION pooler reports success and
-- does nothing (AGENTS.md, 2026-09-06); it must go through port 5432.

-- 1. Never-scanned indexes.
--    agents_agent_id_idx (30 MB): agent_id is chain:registry:token_id,
--    derived entirely from the primary key, so its uniqueness is
--    structural; no query filters on it.
--    agents_uri_scheme_idx (3 MB): every uri_scheme reader uses
--    registry_tokens, never agents.
--    agents_skills_idx (1.1 MB, GIN on the array): superseded by the trgm
--    indexes over skills_text(); containment is not queried anywhere.
drop index if exists public.agents_agent_id_idx;
drop index if exists public.agents_uri_scheme_idx;
drop index if exists public.agents_skills_idx;

-- 2. Supabase linter (function_search_path_mutable): skills_text had a
--    role-mutable search_path.
alter function public.skills_text(text[]) set search_path = public;

-- 3. Recurring maintenance, hourly: keeps the two unbounded growths bounded.
--
--    token_uri on resolved+materialized rows is a cache nothing reads:
--    materialize excludes rows already in agents (not-exists), resolve only
--    touches unresolved rows, and the authoritative URI is the chain read -
--    sync's stored copy is truncated at 500 chars, and it is the chain
--    re-read that heals truncated data: URIs (AGENTS.md). Nulling reclaims
--    ~280 bytes/row; the sync cron's coalesce() means a re-synced token
--    restores its URI only if the chain is re-read for it, which only
--    happens for new mints.
--
--    cron history: 7-day retention.
create or replace function public.gebo_maintain()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update registry_tokens set token_uri = null, checked_at = now()
  where ctid in (
    select ctid from registry_tokens
    where token_uri is not null and resolved
      and exists (select 1 from agents a
                  where a.chain_id = 56 and a.token_id = registry_tokens.token_id)
    limit 5000
  );
  delete from cron.job_run_details where start_time < now() - interval '7 days';
end;
$$;

revoke all on function public.gebo_maintain() from public, anon, authenticated;
grant execute on function public.gebo_maintain() to postgres;

select cron.schedule('gebo-maint', '23 * * * *',
  $$select public.gebo_maintain()$$);
