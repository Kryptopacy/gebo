-- GEBO 0025 - the search and materialize indexes.
--
-- The match predicate ORs full-text (indexed, fine), name ILIKE (NO index:
-- a seq scan over 155k+ agents rows, 90s+ under pooler contention - found
-- 2026-09-07 when live search timed out) and a skills unnest-ILIKE (filter
-- only). A trigram GIN on name lets the planner BitmapOr fts+name instead
-- of scanning everything.
--
-- 0023's materialize candidate index never actually landed - every CREATE
-- INDEX attempt timed out under the refresh saturation and the final one
-- was aborted mid-flight. Re-declared here so it cannot be forgotten.
create extension if not exists pg_trgm with schema extensions;

create index if not exists agents_name_trgm_idx
  on public.agents using gin (name extensions.gin_trgm_ops);

create index if not exists registry_tokens_materialize_idx
  on public.registry_tokens (token_id)
  where resolved and has_name and token_uri is not null;
