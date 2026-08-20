-- GEBO 0007 - schedule classification, and track when it last ran per agent.
--
-- Capability text arrives continuously: the probe job captures A2A card skills
-- every five minutes and the resolver adds descriptions every minute. Nothing
-- read it. Classification only ever ran when a human executed a script, so newly
-- discovered agents stayed unclassified and invisible to category browsing.
--
-- classified_at makes reclassification possible without rescanning everything:
-- an agent is revisited when its card was refetched after it was last classified,
-- because a changed agent card can change what the agent does.

alter table public.agents
  add column if not exists classified_at timestamptz;

-- Drives the classifier's work queue. Partial, so it stays small as coverage grows.
create index if not exists agents_needs_classify_idx
  on public.agents (token_id desc)
  where category is null;

create index if not exists agents_reclassify_idx
  on public.agents (card_fetched_at)
  where card_fetched_at is not null;

-- Every 10 minutes: often enough that a newly probed agent is browsable within
-- one cycle, rare enough that it never competes with the probe job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gebo-classify') then
    perform cron.unschedule('gebo-classify');
  end if;
end $$;

select cron.schedule('gebo-classify', '*/10 * * * *',
  $$select public.gebo_run_cron('/api/cron/classify')$$);
