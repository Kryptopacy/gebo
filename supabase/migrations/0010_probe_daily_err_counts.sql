-- GEBO 0010 - repair double-encoded err_counts, and make the daily merge accumulate.
--
-- Two defects in the probe rollup, found because /live rendered every figure as
-- zero while probes_raw held 43,321 rows.
--
-- ONE: 100 rows written on the first probe day (2026-08-18) hold a jsonb STRING
-- containing the TEXT of the object rather than the object:
--
--   err_counts = '"{\"http_4xx\":1}"'   instead of   '{"http_4xx":1}'
--
-- An early writer stringified before handing the value to the driver, which then
-- encoded it again. The read side used coalesce(err_counts, '{}'::jsonb), which
-- substitutes for SQL NULL and does nothing for a JSON scalar, so those rows
-- reached jsonb_each_text and raised "cannot call jsonb_each_text on a
-- non-object". One rejected promise in a Promise.all returned the all-zero
-- fallback, and the whole ledger read as if nothing had ever been measured.
--
-- The values are recoverable: the string parses as the object it should have been.
-- Casting through text recovers them rather than discarding real observations.
--
-- TWO: `on conflict do update` incremented probes but never touched err_counts, so
-- the error-class breakdown recorded only the FIRST probe of each endpoint-day.
-- Its totals summed to exactly 4,426 - one per row - against sum(probes) many
-- times larger. A breakdown whose denominator is not the number of probes it
-- appears to describe is a misleading metric, which design law L2 exists to
-- prevent. The merge below accumulates per class.

-- Repair, guarded so it is safe to re-run: only strings that parse to an object.
update public.probe_daily
set err_counts = (err_counts #>> '{}')::jsonb
where jsonb_typeof(err_counts) = 'string'
  and (err_counts #>> '{}') is not null
  and left(btrim(err_counts #>> '{}'), 1) = '{';

/**
 * Merge two err_counts objects, summing shared keys.
 *
 * Written as a function so the three writers - the cron route, the probe script
 * and the bulk loader - cannot each implement the merge slightly differently. It
 * treats anything that is not an object as empty, which makes a future encoding
 * slip degrade to a lost count rather than to a query that throws and blanks a
 * page.
 */
create or replace function public.merge_err_counts(a jsonb, b jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with pair as (
    select case when jsonb_typeof(a) = 'object' then a else '{}'::jsonb end as l,
           case when jsonb_typeof(b) = 'object' then b else '{}'::jsonb end as r
  ),
  keys as (
    select k from pair, jsonb_object_keys(l) k
    union
    select k from pair, jsonb_object_keys(r) k
  )
  select coalesce(
    jsonb_object_agg(
      k,
      coalesce((select (l -> k)::text::int from pair), 0)
      + coalesce((select (r -> k)::text::int from pair), 0)
    ),
    '{}'::jsonb
  )
  from keys;
$$;

-- Reject a non-object outright from here on. The repair above clears the existing
-- violations, so this can be enforced rather than merely intended: a value that
-- cannot be read is not worth storing, and a constraint is the only thing that
-- stops the same encoding slip returning through a different writer.
alter table public.probe_daily
  drop constraint if exists probe_daily_err_counts_object_ck;
alter table public.probe_daily
  add constraint probe_daily_err_counts_object_ck
  check (err_counts is null or jsonb_typeof(err_counts) = 'object');
