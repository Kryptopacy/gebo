-- GEBO 0039 - admin cron control: pause/resume from the ops console.
--
-- The console could trigger and monitor but not cancel; the only pause
-- path was a shell script. This adds the store that makes pause/resume
-- reversible: admin_paused_jobs captures the job's full definition
-- (schedule + command, read from cron.job itself - never user input)
-- before unscheduling, so resume is exact.
--
-- COORDINATION WITH THE GUARD (0038): the fleet guard auto-restores
-- gebo-opportunities after sustained health - which would silently undo
-- a deliberate admin pause within the hour. An admin pause must win, so
-- the guard's restore condition now skips jobs present in
-- admin_paused_jobs. Recreated whole for the same reason as 0031.
create table if not exists public.admin_paused_jobs (
  jobname    text primary key,
  schedule   text not null,
  command    text not null,
  paused_at  timestamptz not null default now()
);
alter table public.admin_paused_jobs enable row level security;
-- no policy: internal-only (the admin route runs as the connection role)

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
  if ms >= 2000 then
    update fleet_guard set slow_streak = slow_streak + 1, fast_streak = 0;
  else
    update fleet_guard set fast_streak = fast_streak + 1, slow_streak = 0;
  end if;
  update fleet_guard set last_ms = ms, checked_at = now();
  select slow_streak, fast_streak into slow, fast from fleet_guard;

  -- SHED: two consecutive slow checks, or one catastrophic check.
  if slow >= 2 or ms >= 15000 then
    if exists (select 1 from cron.job where jobname = 'gebo-opportunities') then
      perform cron.unschedule('gebo-opportunities');
      action := 'shed opportunities';
    end if;
    if ms >= 15000 then
      foreach j in array array['gebo-materialize', 'gebo-probe', 'gebo-sync'] loop
        if exists (select 1 from cron.job where jobname = j) then
          perform cron.unschedule(j);
          action := action || ', shed ' || j;
        end if;
      end loop;
    end if;
  end if;

  -- RESTORE: six consecutive healthy checks bring the bonus job back -
  -- unless an ADMIN paused it deliberately, in which case the pause wins
  -- (0039: the guard must not undo a human decision).
  if fast >= 6 then
    if not exists (select 1 from cron.job where jobname = 'gebo-opportunities')
       and not exists (select 1 from admin_paused_jobs where jobname = 'gebo-opportunities') then
      perform cron.schedule('gebo-opportunities', '*/30 * * * *',
        'select public.gebo_run_cron(''/api/cron/opportunities'')');
      action := 'restored opportunities';
    end if;
  end if;

  update fleet_guard set last_action = action;
  return action || ' (latency ' || round(ms) || 'ms, slow=' || slow || ', fast=' || fast || ')';
end;
$fn$;

revoke all on function public.gebo_fleet_guard() from public, anon, authenticated;
grant execute on function public.gebo_fleet_guard() to postgres;
