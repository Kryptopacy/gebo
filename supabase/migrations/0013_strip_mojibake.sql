-- GEBO 0013 - strip CP1252 mojibake from stored agent text.
--
-- probe.ts joined an agent's skill fields with a separator that was itself corrupt:
-- the source file held the UTF-8 bytes for "Ã¢â‚¬â€" rather than an em dash, because a
-- PowerShell write re-encoded the file as Windows-1252. Every skills row written by
-- that code path carries it, and /a/265375 rendered
--
--   "Negotiate an ERC-8183 job Ã¢â‚¬â€ negotiate Ã¢â‚¬â€ Send a data part..."
--
-- The separator is now a plain ASCII hyphen, but existing rows need repair: the
-- classifier tokenises this text, and the agent page prints it.
--
-- Idempotent and narrow - it replaces one exact three-character sequence and touches
-- nothing else. Deliberately not a blanket "convert from CP1252" pass: that was tried
-- on a source file earlier in this project and made things worse by mojibaking the
-- parts that were already correct.

update public.agents
set skills = (
  select array_agg(replace(s, 'Ã¢â‚¬â€', '-') order by ord)
  from unnest(skills) with ordinality as t(s, ord)
)
where skills is not null
  and exists (select 1 from unnest(skills) as s where s like '%Ã¢â‚¬â€%');

update public.agents
set description = replace(description, 'Ã¢â‚¬â€', '-')
where description like '%Ã¢â‚¬â€%';

update public.agents
set name = replace(name, 'Ã¢â‚¬â€', '-')
where name like '%Ã¢â‚¬â€%';

-- probe_events.detail carries the same separator from the
-- "reachable web page - no agent protocol asserted" branch.
update public.probe_events
set detail = replace(detail, 'â€”', '-')
where detail like '%â€”%';