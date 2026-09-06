-- GEBO 0021 — rotate probes_raw. The 48h window was designed but never
-- implemented: no code ever deleted from the table, and by 2026-09-06 it
-- held 18 days / 200 MB of the 500 MB free tier (the database measured
-- 442 MB with the backfill mid-flight). Hourly direct SQL — no HTTP hop,
-- nothing to deploy. Row volume is bounded by the probe cron's own batch
-- cap (~13k probes/day), so this keeps the table at ~2 days of that.
select cron.schedule('gebo-probes-rotate', '17 * * * *',
  $$delete from probes_raw where at < now() - interval '48 hours'$$);
