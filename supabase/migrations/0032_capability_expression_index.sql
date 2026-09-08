-- GEBO 0032 - capability_doc as an expression index instead of a stored
-- generated column (the 37 MB lever recorded in AGENTS.md after the
-- 2026-09-07 surgery).
--
-- The stored tsvector costs 36.7 MB across 257k agents and ~150 bytes per
-- new row, forever, because a GENERATED ALWAYS column recomputes on every
-- write. Postgres can hold the same search structure as an expression
-- index: the tsvector then exists once, in the index, not per row.
--
-- ORDERING CONSTRAINT (why this is 0032 and the drop is 0033):
--   1. THIS migration creates the expression index - additive, no query
--      changes, deployed search keeps using the column.
--   2. The code deploys, switching MATCH_PREDICATE and the ts_rank ordering
--      to the exact same expression, so the planner binds to THIS index.
--   3. Only after the deployed search is verified live does 0033 drop the
--      column (and with it the old agents_capability_fts_idx).
-- Dropping the column before step 2 breaks the deployed search - the exact
-- coordinated-deploy failure the materialize route showed in August.
--
-- The expression must match the queries byte-for-byte: the generated column
-- was to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
-- (0006), and MATCH_PREDICATE now repeats that exact form.
-- CONCURRENTLY: the non-concurrent trgm build earlier today locked agents
-- for 12 minutes, queueing every write cron behind it. Concurrently never
-- blocks writes at ~1.5x build time. Caveat: an interrupted concurrent build
-- leaves an INVALID index that Postgres ignores - check pg_index.indisvalid
-- after applying, and if false: drop and rerun.
create index concurrently if not exists agents_capability_expr_idx
  on public.agents using gin (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
  );
