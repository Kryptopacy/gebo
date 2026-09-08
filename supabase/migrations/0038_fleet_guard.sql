-- GEBO 0038 - the fleet guard: self-shedding load management for the free tier.
--
-- 2026-09-08's two throttle incidents needed a human to run tmp-stand-down
-- and tmp-restore-crons. During unattended judging that human may not be
-- there, and an unattended throttle is hours of degraded site. This guard
-- is pure direct SQL (no HTTP hop, so it always runs) and manages the one
-- knob that matters: the BONUS job (gebo-opportunities, the thin-cadence
-- extra whose data freshness and snapshot accumulation are worth having
-- when the tier can carry them).
--
-- Hysteresis, not flapping:
--   - latency measured as the execution time of an index-probe count
--     (under CPU throttle this inflates; when healthy it is sub-ms)
--   - SHED the bonus job after 2 consecutive checks above 5s (the panic
--     tier: also shed materialize + probe + sync above 15s, mirroring the
--     manual stand-down that recovered both incidents)
--   - RESTORE only after 6 consecutive checks under 500ms (~1h healthy at
--     the 10-minute check cadence)
--   - the floor fleet (resolve, counts, maint, daily jobs) is never
--     touched - it is the proven-stable minimum
create table if not exists public.fleet_guard (
  id          integer primary key default 1 check (id = 1),
  slow_streak integer not null default 0,
  fast_streak integer not null default 0,
  last_ms     numeric not null default 0,
  checked_at  timestamptz not null default now(),
  last_action text not null default 'init'
);
insert into public.fleet_guard (id) values (1) on conflict (id) do nothing;

alter table public.fleet_guard enable row level security;
-- no policy: internal-only

create or replace function public.gebo_db_latency_ms()
returns numeric
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  t0 timestamptz;
  n bigint;
begin
  t0 := clock_timestamp();
  select count(*) into n from agents where token_id = -1;
  return 1000 * extract(epoch from (clock_timestamp() - t0));
end;
$fn$;

create or replace function public.gebo_fleet_guard()
returns text
language plpgsql
security invoker
set search_path = public, cron
as $fn$
declare
  ms numeric;
  slow int;
  fast int;
  action text := 'none';
  j text;
begin
  ms := public.gebo_db_latency_ms();
  if ms > 5000 then
    update fleet_guard set slow_streak = slow_streak + 1, fast_streak = 0;
  elsif ms < 500 then
    update fleet_guard set fast_streak = fast_streak + 1, slow_streak = 0;
  else
    update fleet_guard set slow_streak = 0, fast_streak = 0;
  end if;
  update fleet_guard set last_ms = ms, checked_at = now();
  select slow_streak, fast_streak into slow, fast from fleet_guard;

  -- SHED: two consecutive slow checks, or one catastrophic check.
  if slow >= 2 or ms > 15000 then
    if exists (select 1 from cron.job where jobname = 'gebo-opportunities') then
      perform cron.unschedule('gebo-opportunities');
      action := 'shed opportunities';
    end if;
    if ms > 15000 then
      -- panic tier: mirror the manual stand-down that recovered both
      -- incidents; resolve and counts stay (the proven floor).
      foreach j in array array['gebo-materialize', 'gebo-probe', 'gebo-sync'] loop
        if exists (select 1 from cron.job where jobname = j) then
          perform cron.unschedule(j);
          action := action || ', shed ' || j;
        end if;
      end loop;
    end if;
  end if;

  -- RESTORE: six consecutive healthy checks bring the bonus job back
  -- (materialize/probe/sync come back via tmp-restore-crons or by hand -
  -- a panic shed is a human-attention event, not something to auto-retry).
  if fast >= 6 then
    if not exists (select 1 from cron.job where jobname = 'gebo-opportunities') then
      perform cron.schedule('gebo-opportunities', '*/30 * * * *',
        'select public.gebo_run_cron(''/api/cron/opportunities'')');
      action := 'restored opportunities';
    end if;
  end if;

  update fleet_guard set last_action = action;
  return action || ' (latency ' || round(ms) || 'ms, slow=' || slow || ', fast=' || fast || ')';
end;
$fn$;

revoke all on function public.gebo_db_latency_ms() from public, anon, authenticated;
revoke all on function public.gebo_fleet_guard() from public, anon, authenticated;
grant execute on function public.gebo_db_latency_ms() to postgres;
grant execute on function public.gebo_fleet_guard() to postgres;

-- The guard itself: every 10 minutes, direct SQL, cheaper than any job it manages.
select cron.schedule('gebo-guard', '8,18,28,38,48,58 * * * *',
  $$select public.gebo_fleet_guard()$$);

-- The bonus job, at the thin cadence the guard now protects.
select cron.schedule('gebo-opportunities', '*/30 * * * *',
  $$select public.gebo_run_cron('/api/cron/opportunities')$$);
