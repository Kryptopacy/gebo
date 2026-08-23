-- GEBO 0011 - close the SECURITY DEFINER functions that PUBLIC could execute.
--
-- 0005 already contained:
--
--   revoke all on function public.gebo_secret(text) from anon, authenticated;
--
-- and it did nothing useful. Postgres grants EXECUTE to PUBLIC by default when a
-- function is created, and anon and authenticated inherit through PUBLIC, so
-- revoking from the named roles leaves the real grant untouched. The ACL showed
-- it plainly once looked at:
--
--   gebo_secret(p_name text)   acl = =X/postgres | postgres=X/postgres
--                                    ^ empty grantee before "=" IS public
--
-- Consequences, in severity order:
--
--   gebo_secret   reads vault.decrypted_secrets. Supabase exposes public-schema
--                 functions over PostgREST at /rest/v1/rpc, so this was a path to
--                 the cron bearer token from outside the database. This project
--                 has already leaked a live secret once; that is why
--                 scripts/cron-fingerprint.ts compares hashes instead of printing
--                 values. This is the same failure at the database layer.
--
--   gebo_run_cron dispatches an authenticated HTTP request to our own cron
--                 endpoints. Callable by anyone, it is unbounded job triggering:
--                 duplicate probe sweeps, wasted function invocations, and a
--                 request amplifier pointed at our deployment.
--
--   rls_auto_enable is an event-trigger function, so PostgREST cannot actually
--                 invoke it - the return type is not a SQL type. Revoked anyway
--                 because a default-open SECURITY DEFINER function is a standing
--                 hazard, and the revoke costs nothing.
--
-- REVOKE FROM PUBLIC IS THE OPERATIVE LINE. The named roles are listed too, so the
-- intent survives a future GRANT to one of them.
--
-- pg_cron is unaffected: jobs run as postgres, which holds EXECUTE explicitly
-- (postgres=X/postgres above) rather than through PUBLIC.

revoke all on function public.gebo_secret(text)   from public, anon, authenticated;
revoke all on function public.gebo_run_cron(text) from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Keep them callable by the roles that must call them. postgres owns and runs the
-- cron jobs; service_role is the trusted server-side identity.
grant execute on function public.gebo_secret(text)   to postgres;
grant execute on function public.gebo_run_cron(text) to postgres;

/**
 * Move pg_net out of the public schema.
 *
 * `create extension if not exists pg_net` in 0005 carried no schema, so it landed
 * in public. Its FUNCTIONS live in the separate `net` schema, which is why
 * net.http_get resolves and why nothing breaks today - this is namespace hygiene
 * rather than an exploit.
 *
 * Attempted rather than asserted, and warned about rather than fatal. The
 * revocations above are the security-critical part of this migration and must not
 * be rolled back by a relocation that some Supabase tiers disallow. A failure here
 * is reported so it is visible, which is the same standard the scripts hold: say
 * when you could not do something rather than passing quietly.
 */
do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';

  if v_schema is null then
    raise warning 'pg_net is not installed; nothing to relocate';
  elsif v_schema <> 'public' then
    raise notice 'pg_net already outside public (schema: %)', v_schema;
  else
    begin
      execute 'alter extension pg_net set schema extensions';
      raise notice 'pg_net relocated from public to extensions';
    exception when others then
      raise warning 'could not relocate pg_net out of public: %', sqlerrm;
    end;
  end if;
end $$;
