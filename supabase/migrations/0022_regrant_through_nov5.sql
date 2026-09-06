-- GEBO 0022 — keep Altana demo sessions live through any late judging.
--
-- 0015/0018 cover Sep 7-23, the published judging window. But partner tracks
-- "run on their own judging criteria" with no published end date, and the
-- winner announcement is Nov 5: an Altana judge opening the explorer in
-- October would find expired keys. Testnet gas makes this free insurance
-- (demo wallet held 0.46 tBNB; a grant day costs well under 0.01). All three
-- schedules self-expire — cron expressions scoped to fixed date ranges, no
-- cleanup needed.
select cron.schedule('gebo-regrant-late-sep', '0 6 24-30 9 *',
  $$select public.gebo_run_cron('/api/cron/regrant')$$);
select cron.schedule('gebo-regrant-oct', '0 6 1-31 10 *',
  $$select public.gebo_run_cron('/api/cron/regrant')$$);
select cron.schedule('gebo-regrant-nov', '0 6 1-5 11 *',
  $$select public.gebo_run_cron('/api/cron/regrant')$$);
