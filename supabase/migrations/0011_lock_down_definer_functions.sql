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
 * pg_net's schema is handled in 0012, not here.
 *
 * This migration first attempted `alter extension pg_net set schema extensions`,
 * which always fails: pg_net is declared non-relocatable, so Postgres refuses with
 * "extension pg_net does not support SET SCHEMA". The attempt was left in place
 * warning on every migrate run, which is noise rather than information.
 *
 * 0012 does it properly by dropping and recreating the extension, gated on an
 * end-to-end delivery check because pg_net's send path is asynchronous and its
 * failure mode is silence rather than an error.
 */
