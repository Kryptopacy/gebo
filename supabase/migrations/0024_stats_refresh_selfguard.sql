-- GEBO 0024 - refresh_census_stats guards ITSELF against saturation.
--
-- The function is a full-table aggregation over 337k rows (30-90s on the
-- free tier), and 2026-09-07 it was called at the end of every sync and
-- resolve pass - crons that fire every minute. Overlapping refreshes
-- saturated the pooler and queued every user-facing query behind them; live
-- search timed out while two ran concurrently.
--
-- The in-app guard (src/lib/census-refresh.ts) only helps once a deploy
-- lands; this makes the FUNCTION refuse to overlap or re-run fresh stats,
-- whichever code version calls it:
--   - pg_try_advisory_lock: a second concurrent caller returns immediately
--   - updated_at staleness check: a caller within 10 minutes of the last
--     refresh returns immediately
-- The funnel renders with a measured_at qualifier, so 10-minute freshness
-- loses nothing user-facing.
create or replace function public.refresh_census_stats()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total        bigint;
  v_endpoints    bigint;
  v_last         timestamptz;
begin
  -- Guard 1: another refresh is already running - let it finish.
  if not pg_try_advisory_lock(hashtext('refresh_census_stats')) then
    return;
  end if;
  begin
    -- Guard 2: stats are fresh enough - do not pay the aggregation again.
    select updated_at into v_last from census_stats where id = 'bsc';
    if v_last is not null and now() - v_last < interval '10 minutes' then
      return;
    end if;

    select count(*) into v_total from registry_tokens;
    select coalesce(sum(endpoint_count), 0) into v_endpoints from registry_tokens;

    insert into census_stats as cs (
      id, chain_id, registry,
      tokens_minted, censused, resolved, named, claim_active, with_endpoint, callable,
      operators, owners, owners_with_one_agent,
      largest_operator_share, top5_operator_share, top20_operator_share, top10_owner_share,
      declares_reputation, empty_token_uri, x402_supported, fatal_defects,
      uri_schemes, endpoint_kinds, trust_models, top_operators,
      measured_at, updated_at
    )
    select
      'bsc', 56, '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432',
      (select coalesce(max(token_id), 0) from registry_tokens),
      v_total,
      (select count(*) from registry_tokens where resolved),
      (select count(*) from registry_tokens where has_name),
      (select count(*) from registry_tokens where claim_active),
      (select count(*) from registry_tokens where endpoint_count > 0),
      (select count(*) from registry_tokens where callable),
      (select count(distinct operator_domain) from registry_tokens where operator_domain is not null),
      (select count(distinct owner) from registry_tokens where owner is not null),
      (select count(*) from (
          select owner from registry_tokens where owner is not null
          group by owner having count(*) = 1) s),
      (select round(coalesce(100.0 * max(c) / nullif(v_endpoints, 0), 0), 2) from (
          select sum(endpoint_count) as c from registry_tokens
          where operator_domain is not null group by operator_domain) a),
      (select round(coalesce(100.0 * sum(c) / nullif(v_endpoints, 0), 0), 2) from (
          select sum(endpoint_count) as c from registry_tokens
          where operator_domain is not null group by operator_domain
          order by 1 desc limit 5) b),
      (select round(coalesce(100.0 * sum(c) / nullif(v_endpoints, 0), 0), 2) from (
          select sum(endpoint_count) as c from registry_tokens
          where operator_domain is not null group by operator_domain
          order by 1 desc limit 20) d),
      (select round(coalesce(100.0 * sum(c) / nullif(v_total, 0), 0), 2) from (
          select count(*) as c from registry_tokens
          where owner is not null group by owner order by 1 desc limit 10) e),
      (select count(*) from registry_tokens where 'reputation' = any(trust_models)),
      (select count(*) from registry_tokens where uri_scheme = 'empty'),
      (select count(*) from registry_tokens where x402),
      (select count(*) from registry_tokens where has_fatal),
      (select coalesce(jsonb_object_agg(uri_scheme, n), '{}'::jsonb) from (
          select uri_scheme, count(*) as n from registry_tokens
          where uri_scheme is not null group by uri_scheme) f),
      (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
          select kind, count(*) as n from agent_endpoints where chain_id = 56 group by kind) g),
      (select coalesce(jsonb_object_agg(tm, n), '{}'::jsonb) from (
          select tm, count(*) as n from (
            select unnest(trust_models) as tm from registry_tokens) h
          where tm is not null and tm <> '' group by tm order by 2 desc limit 12) i),
      (select coalesce(jsonb_agg(jsonb_build_object(
          'domain', operator_domain, 'endpoints', eps, 'callable', callables)
          order by eps desc), '[]'::jsonb)
        from (
          select operator_domain, sum(endpoint_count) as eps,
                 count(*) filter (where callable) as callables
          from registry_tokens
          where operator_domain is not null
          group by operator_domain
          order by eps desc limit 12) j),
      now(),
      now()
      on conflict (id) do update
      set tokens_minted = excluded.tokens_minted,
          censused = excluded.censused,
          resolved = excluded.resolved,
          named = excluded.named,
          claim_active = excluded.claim_active,
          with_endpoint = excluded.with_endpoint,
          callable = excluded.callable,
          operators = excluded.operators,
          owners = excluded.owners,
          owners_with_one_agent = excluded.owners_with_one_agent,
          largest_operator_share = excluded.largest_operator_share,
          top5_operator_share = excluded.top5_operator_share,
          top20_operator_share = excluded.top20_operator_share,
          top10_owner_share = excluded.top10_owner_share,
          declares_reputation = excluded.declares_reputation,
          empty_token_uri = excluded.empty_token_uri,
          x402_supported = excluded.x402_supported,
          fatal_defects = excluded.fatal_defects,
          uri_schemes = excluded.uri_schemes,
          endpoint_kinds = excluded.endpoint_kinds,
          trust_models = excluded.trust_models,
          top_operators = excluded.top_operators,
          measured_at = now(),
          updated_at = now();
  exception when others then
    -- The advisory lock releases on rollback anyway (session-level locks are
    -- released at transaction end); re-raise so callers see real errors.
    raise;
  end;
  perform pg_advisory_unlock(hashtext('refresh_census_stats'));
end;
$$;
