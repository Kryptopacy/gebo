-- GEBO 0012 - move pg_net out of the public schema.
--
-- 0005 ran "create extension if not exists pg_net" with no schema, so it landed in
-- public and the Supabase linter flags it. The obvious remedy does not work:
--
--   alter extension pg_net set schema extensions;
--   ERROR: extension "pg_net" does not support SET SCHEMA
--
-- because pg_net is declared non-relocatable (pg_extension.extrelocatable = false).
-- The only route is drop and recreate, which is worth doing ONLY because the
-- failure mode turned out to be verifiable. It very nearly was not.
--
-- WHY THIS NEEDED CARE. gebo_run_cron calls net.http_get, which QUEUES a request
-- and returns void immediately; a background worker performs the send. If that
-- worker does not return after a reinstall, all six cron jobs keep reporting
-- "succeeded" - because queueing did succeed - while no HTTP request is ever made.
-- The whole data pipeline would stop and every dashboard would look healthy. That
-- is the silent-failure class this codebase has spent real effort removing, so it
-- was not acceptable to attempt this blind.
--
-- Two things make it safe:
--   * net.worker_restart() exists in pg_net 0.20.4, so the worker can be brought
--     back deliberately rather than hoped for.
--   * a request can be observed end to end - queue an http_get, then read
--     net._http_response for that id. scripts/verify-pgnet.ts does exactly that and
--     is the gate on this migration having worked.
--
-- WHY NOTHING CASCADES. gebo_run_cron is plpgsql, and plpgsql bodies are not parsed
-- at creation time, so its reference to net.http_get is not a recorded dependency.
-- Dropping the extension therefore cannot take the function with it. This would be
-- unsafe for a SQL-language function, where the reference IS a dependency.
--
-- WHAT IS LOST. net._http_response holds recent response bodies and net
-- .http_request_queue holds pending sends. Both are ephemeral by design - pg_net
-- reaps responses on a TTL - and no GEBO code reads them outside diagnostics.
--
-- WORST CASE DURING THE WINDOW. gebo-resolve runs every minute. If it fires while
-- the extension is absent, that one invocation errors and is logged as failed; the
-- next minute proceeds normally. A single missed resolve slice is self-healing,
-- since the work queue is derived from state rather than from a cursor.

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';

  if v_schema is null then
    raise warning 'pg_net is not installed; nothing to do';
    return;
  end if;

  if v_schema <> 'public' then
    raise notice 'pg_net already outside public (schema: %); nothing to do', v_schema;
    return;
  end if;

  -- Ensure the target exists. Supabase ships it, but this migration should not
  -- assume another migration's side effects.
  create schema if not exists extensions;

  raise notice 'reinstalling pg_net from public into extensions';
  execute 'drop extension pg_net';
  execute 'create extension pg_net with schema extensions';

  -- The functions live in the separate `net` schema regardless of where the
  -- extension itself is registered, which is why net.http_get keeps resolving and
  -- why gebo_run_cron needs no edit.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_get'
  ) then
    raise exception 'net.http_get is missing after reinstall; rolling back';
  end if;
end $$;

-- Bring the background worker back deliberately. Outside the DO block so it runs
-- after the reinstall is settled, and guarded because the function only exists in
-- newer pg_net.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'worker_restart'
  ) then
    perform net.worker_restart();
    raise notice 'pg_net worker restarted';
  else
    raise warning 'net.worker_restart() not available; verify the queue drains';
  end if;
end $$;
