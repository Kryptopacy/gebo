-- GEBO 0005 — schedule the refresh jobs from inside the database.
--
-- Why here rather than CI or platform cron:
--   * GitHub Actions is unavailable (account billing lock), so no workflow runs.
--   * Vercel Hobby caps cron at once per day, which cannot sustain a 15-minute
--     probe cadence or clear a ~100k registration backlog.
--   * Supabase ships pg_cron and pg_net on every tier, so the database can call
--     our own endpoints on any schedule at no cost, with the schedule living
--     beside the data it maintains.
--
-- pg_net dispatches asynchronously: net.http_get queues a request and returns
-- immediately, so a slow endpoint never blocks the scheduler.
--
-- SETUP (run once, values not stored in this file):
--
--   select vault.create_secret('https://your-app.vercel.app', 'gebo_site_url');
--   select vault.create_secret('<CRON_SECRET>',               'gebo_cron_secret');
--
-- Secrets live in Supabase Vault rather than inline, so the bearer token is not
-- readable from pg_cron.job or from this migration in source control.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Read a secret from Vault by name, or null when absent.
create or replace function public.gebo_secret(p_name text)
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

revoke all on function public.gebo_secret(text) from anon, authenticated;

-- Fire one cron endpoint. No-ops loudly if setup is incomplete, so a missing
-- secret shows up in the job log rather than silently doing nothing forever.
create or replace function public.gebo_run_cron(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base   text := public.gebo_secret('gebo_site_url');
  v_secret text := public.gebo_secret('gebo_cron_secret');
begin
  if v_base is null or v_secret is null then
    raise warning 'gebo_run_cron(%): gebo_site_url or gebo_cron_secret missing from vault', p_path;
    return;
  end if;

  perform net.http_get(
    url     := v_base || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.gebo_run_cron(text) from anon, authenticated;

-- Replace any previous schedule so this migration is idempotent.
do $$
declare j text;
begin
  foreach j in array array['gebo-probe', 'gebo-resolve', 'gebo-sync', 'gebo-opportunities']
  loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;

-- Liveness. Tiered next_probe_at means a run only touches what is due, so a
-- tight cadence costs little and keeps validated agents genuinely current.
select cron.schedule('gebo-probe', '*/5 * * * *',
  $$select public.gebo_run_cron('/api/cron/probe')$$);

-- Registration backlog. A 120-row slice each minute clears far more per day
-- than the queue receives.
select cron.schedule('gebo-resolve', '* * * * *',
  $$select public.gebo_run_cron('/api/cron/resolve')$$);

-- New identities. BNB Chain adds a few hundred a day; this keeps the funnel
-- within minutes of chain state.
select cron.schedule('gebo-sync', '*/5 * * * *',
  $$select public.gebo_run_cron('/api/cron/sync')$$);

-- Pool ticks and lending rates move continuously, so a stale opportunity
-- surface is a wrong one.
select cron.schedule('gebo-opportunities', '*/10 * * * *',
  $$select public.gebo_run_cron('/api/cron/opportunities')$$);
