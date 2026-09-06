-- GEBO 0019 — schedule census → agents materialization.
--
-- The census crons (sync, resolve) keep registry_tokens current to within
-- minutes of chain, but every user-facing surface reads `agents` and
-- `agent_endpoints`, which until 2026-09-06 were only populated by hand-run
-- loaders and had frozen at token #269686 while the census ran on to #336715.
-- ~67k agents registered after that — an entire hackathon mint wave — were
-- censused, resolved, and invisible to search, categories, cards and probes.
--
-- Every 2 minutes keeps up with a 1,500/day mint wave many times over and
-- chews the pre-existing backlog (the backfill script clears it faster).
select cron.schedule('gebo-materialize', '*/2 * * * *',
  $$select public.gebo_run_cron('/api/cron/materialize')$$);
