-- GEBO 0035 - opportunity fields: grid ruin probability + health oracle
-- disclosure (spec: PRODUCT_SPEC opportunity schemas).
--
-- Grid ruinProbabilityEstimate needs realized volatility, and the only
-- on-chain source (V3 pool observe()) reaches ~4h of history on BSC pools
-- (measured 2026-09-07: 6h+ reverts OLD) - a 4-point estimate would be
-- dishonest precision. So the opportunity cron now snapshots every pool's
-- tick at most hourly into pool_tick_snapshots, and the estimate publishes
-- only once >= 48 hourly deltas spanning >= 72h exist (src/lib/grid-risk.ts
-- enforces the thresholds; the render shows "accumulating" until then).
--
-- Health oracleStalenessSec / protocolPaused: probed, genuinely unreadable
-- through the Comptroller (getTokenConfig returns no usable source layout;
-- getActionPaused/getMarketPauseFlags revert on the Diamond) - the payload
-- carries explicit null-with-reason (invariant 9), plus the one measurable
-- proxy that IS readable: oracle price vs deepest-pool market price
-- divergence for BNB. No migration needed for those; they are payload
-- fields. This migration carries only the snapshot store.
create table if not exists public.pool_tick_snapshots (
  id     bigint generated always as identity primary key,
  pool   text not null,
  tick   integer not null,
  at     timestamptz not null default now()
);
create index if not exists pool_tick_snapshots_pool_at_idx
  on public.pool_tick_snapshots (pool, at desc);

alter table public.pool_tick_snapshots enable row level security;
drop policy if exists pool_tick_snapshots_public_read on public.pool_tick_snapshots;
create policy pool_tick_snapshots_public_read on public.pool_tick_snapshots
  for select to anon, authenticated using (true);

-- gebo_maintain gains snapshot retention: 14 days covers the model's 7-day
-- window with margin. Recreated whole (same body as 0031 plus the delete).
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
  delete from pool_tick_snapshots where at < now() - interval '14 days';
end;
$$;

revoke all on function public.gebo_maintain() from public, anon, authenticated;
grant execute on function public.gebo_maintain() to postgres;
