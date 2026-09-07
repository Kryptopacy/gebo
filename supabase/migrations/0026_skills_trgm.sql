-- GEBO 0026 - index every arm of the search match predicate.
--
-- The predicate ORs full-text (GIN-indexed), name ILIKE (trigram-indexed
-- since 0025) and two skills ILIKE arms that NO index can serve - so every
-- search seq-scanned all 200k+ agents even for queries matching 74 rows
-- (measured: "grid" took 21s for 74 matches, 2026-09-07).
--
-- array_to_string is STABLE, not IMMUTABLE, so it cannot appear in an index
-- expression directly. The wrapper below declares immutability explicitly:
-- inputs are a text[] and a constant separator, so the conservatism of the
-- STABLE marking (NULL-element locale behaviour) does not apply to what we
-- index. The predicate must use the SAME expression (skills_text) or the
-- planner will not match the index.
create or replace function public.skills_text(s text[])
returns text language sql immutable parallel safe as $$
  select coalesce(array_to_string(s, ' '), '')
$$;

create index concurrently if not exists agents_skills_trgm_idx
  on public.agents using gin ((public.skills_text(skills)) gin_trgm_ops);

create index concurrently if not exists agents_skills_norm_trgm_idx
  on public.agents using gin ((replace(public.skills_text(skills), '-', ' ')) gin_trgm_ops);
