-- GEBO 0018 — keep Altana demo sessions live through the whole judging window.
--
-- 0015 scheduled two one-shot regrants around the Sep 9 submission close, but
-- judging runs Sep 9 - Sep 23 and sessions expire <=48h by design: a judge
-- opening the Altana explorer on Sep 12 would have found expired keys. This
-- schedules a daily regrant for Sep 7-23. The route is idempotent (it skips
-- sessions still valid), so extra runs cost nothing.
--
-- The cron expression is self-expiring: "0 6 7-23 9 *" can only fire between
-- Sep 7 and Sep 23, so no unschedule cleanup is needed after the hackathon.
-- 06:00 UTC daily keeps >=24h of validity on every session at all times.
select cron.schedule('gebo-regrant-daily', '0 6 7-23 9 *',
  $$select public.gebo_run_cron('/api/cron/regrant')$$);
