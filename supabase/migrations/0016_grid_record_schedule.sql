-- GEBO 0016 — schedule the grid trading record's daily refresh.
--
-- The grid agent's trading record (grid_win_rate_*, grid_edge_vs_hold_*,
-- grid_max_drawdown_* in metric_values) replays the advised strategy over
-- rolling 7d and 30d windows. Rolling windows need recomputation, and the
-- record's own staleness rule (rows older than 26h stop rendering) exists so
-- a broken refresh shows on the card as an explicit absence rather than an
-- outdated number. Daily at 07:17 UTC: outside the 5-minute cron cluster, so
-- the run is visible on its own in cron status.

select cron.schedule('gebo-grid-record', '17 7 * * *',
  $$select public.gebo_run_cron('/api/cron/grid-record')$$);
