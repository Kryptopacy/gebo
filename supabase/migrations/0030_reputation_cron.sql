-- GEBO 0030 - scheduled ERC-8004 reputation write-back (spec: writeback:erc8004).
--
-- The write-back existed only as a hand-run script: 7 writes total, each a
-- proof, none a producer. The strategy doc calls being a reputation producer
-- the moat, and a moat that depends on someone remembering to run a script is
-- not one. Six hours matches the spec's batch cadence and keeps gas spend
-- bounded (the route caps itself to 3 writes per run, and every gate -
-- probe floor, population veto, already-written skip - lives in the shared
-- src/lib/reputation-producer.ts the CLI also uses).
--
-- DEPLOY BEFORE THE FIRST FIRE: this schedules an HTTP call to
-- /api/cron/reputation, and deploys are manual (AGENTS.md). Until the route
-- is deployed, pg_net records 404s - the exact failure shape the materialize
-- route showed in August. Schedule is on the 6-hour UTC boundary; applying
-- this migration more than a few hours before deploying wastes nothing but
-- produces one failed run per boundary.
select cron.schedule('gebo-reputation', '0 */6 * * *',
  $$select public.gebo_run_cron('/api/cron/reputation')$$);
