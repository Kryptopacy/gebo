-- GEBO 0026 - index every arm of the search match predicate.
--
-- The predicate ORs full-text (GIN-indexed), name ILIKE (trigram-indexed
-- since 0025) and two skills unnest-ILIKE arms that NO index can serve -
-- so every search seq-scanned all 200k+ agents even for queries matching
-- 74 rows (measured: "grid" took 21s for 74 matches, 2026-09-07). Rewriting
-- the arms as expressions over array_to_string lets these expression
-- trigram indexes serve them, so the planner can BitmapOr all three arms
-- and stop scanning.
create index concurrently if not exists agents_skills_trgm_idx
  on public.agents using gin ((array_to_string(skills, ' ')) gin_trgm_ops);

create index concurrently if not exists agents_skills_norm_trgm_idx
  on public.agents using gin ((replace(array_to_string(skills, ' '), '-', ' ')) gin_trgm_ops);
