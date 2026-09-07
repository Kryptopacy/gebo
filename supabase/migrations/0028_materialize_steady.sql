-- GEBO 0028 - steady-state materialize cadence.
--
-- 0019/0020 sized materialize for the 234k backlog (every minute). The
-- backlog is now drained (3,988 remaining, 2026-09-07) and the census and
-- agents high-water marks are aligned. At the historical mint rate
-- (~1.5k/day) every 3 minutes is 50x headroom while cutting the every-
-- minute INSERT pressure that made user-facing search latency fluctuate
-- 2-16s with the cron cycle.
select cron.schedule('gebo-materialize', '*/3 * * * *',
  $$select public.gebo_run_cron('/api/cron/materialize')$$);
