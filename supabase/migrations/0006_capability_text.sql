-- GEBO 0006 — capture what agents say they can do.
--
-- Classification currently matches on name alone, which classifies 82 of 21,278
-- agents. The names show why: "premium", "ala", "Agent", "Professor",
-- "bubbleaiagent" eleven times over. A name is not a capability.
--
-- The richest available signal is already being fetched and discarded. Every A2A
-- agent card carries a `skills` array — the agent's own account of what it does —
-- and the prober counted the entries then threw away the content. Registration
-- files also carry `description`.
--
-- Note on the index: an earlier version put array_to_string(skills, ' ') inside
-- the tsvector expression, which Postgres rejects because that function is only
-- STABLE, not IMMUTABLE, and index expressions must be immutable. The searchable
-- document is therefore maintained as a generated column over the plain text
-- fields, with skills indexed separately for containment queries.

alter table public.agents
  add column if not exists description text,
  add column if not exists skills text[],
  add column if not exists card_fetched_at timestamptz;

alter table public.registry_tokens
  add column if not exists description text;

-- Plain-text capability document. to_tsvector with an explicit configuration is
-- immutable, so this is indexable.
alter table public.agents
  drop column if exists capability_doc;

alter table public.agents
  add column capability_doc tsvector
  generated always as (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) stored;

create index if not exists agents_capability_fts_idx on public.agents using gin (capability_doc);
create index if not exists agents_skills_idx         on public.agents using gin (skills);
create index if not exists agents_category_null_idx  on public.agents (chain_id) where category is null;
