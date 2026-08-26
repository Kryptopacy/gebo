-- GEBO 0015 — schedule Altana session re-grant for hackathon judging.
--
-- Sessions expire <=48h by design. The hackathon judging window is Sep 9+,
-- so sessions must be re-granted near that date. Two one-time cron jobs:
--   Sep 8 12:00 UTC — grant 24h before judging opens
--   Sep 9 08:00 UTC — refresh again morning of submission close
--
-- After Sep 9, unschedule both:
--   select cron.unschedule('gebo-regrant-1');
--   select cron.unschedule('gebo-regrant-2');

-- Sep 8 12:00 UTC
select cron.schedule('gebo-regrant-1', '0 12 8 9 *',
  $$select public.gebo_run_cron('/api/cron/regrant')$$);

-- Sep 9 08:00 UTC
select cron.schedule('gebo-regrant-2', '0 8 9 9 *',
  $$select public.gebo_run_cron('/api/cron/regrant')$$);
