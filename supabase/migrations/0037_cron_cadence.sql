-- GEBO 0037 - thin the aggregate cron load on the free tier.
--
-- 2026-09-08 morning: the database saturated (every cron query ~50x slow -
-- resolve 16s vs a 350ms mean, census refresh 2 minutes, zero blocked
-- locks, pure CPU contention). Load attribution: gebo-counts ran the FULL
-- agents aggregate every 5 minutes (12 scans/hour) and the census gate
-- allowed a full census aggregate every 10 (up to 6/hour), on top of the
-- ordinary fleet and the morning mint wave. The free tier's shared CPU
-- cannot carry ~18 full-table scans per hour.
--
-- Cadence relaxations, both with the staleness windows that keep them
-- honest:
--   gebo-counts:  */5  -> */15   (4 scans/hour; the landing read serves a
--                               row for 45 min = three missed runs before
--                               falling back to the direct query)
--   census gate:  10 min -> 30 min in src/lib/census-refresh.ts (figures
--                               carry measured_at; they move fractions of
--                               a percent between runs)
select cron.schedule('gebo-counts', '*/15 * * * *',
  $$select public.refresh_registry_counts()$$);
