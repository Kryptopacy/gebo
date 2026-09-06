-- GEBO 0020 — materialize every minute while the backlog exists.
--
-- 0019 ran it every 2 minutes, sized to keep up with the mint wave (~1.5k
-- agents/day). The 2026-09-06 backfill also exposed a ~205k historical
-- backlog, and clearing it through a developer machine was fragile: the
-- process dies on reboot and someone has to remember to re-run it. At
-- one-minute cadence the deployed route alone clears the backlog in
-- roughly a day, with no machine involved. When the backlog is empty
-- each run is a single cheap SELECT that returns nothing, so the minute
-- cadence is harmless forever after.
select cron.schedule('gebo-materialize', '* * * * *',
  $$select public.gebo_run_cron('/api/cron/materialize')$$);
