-- GEBO 0013 - strip CP1252 mojibake from stored agent text.
--
-- probe.ts joined an agent's skill fields with a separator that was itself corrupt:
-- the source file held the UTF-8 bytes for CP1252 mojibake rather than an em dash,
-- because a PowerShell write re-encoded the file. Every skills row written by that
-- path carries it, and the agent page printed it.
--
-- WRITTEN WITH UNICODE ESCAPES, NOT LITERAL CHARACTERS. The first attempt pasted the
-- mojibake directly and matched zero rows, because the sequence is
--
--   U+00E2  U+20AC  U+201D        (em dash E2 80 94 read as Windows-1252)
--
-- and the pasted third character was an em dash rather than a right double quote.
-- A migration that repairs an encoding bug must not depend on this file's own
-- encoding surviving another editor, so every byte is escaped.
--
-- Idempotent and narrow: one exact three-character sequence, nothing else.
-- Deliberately not a blanket CP1252 conversion - that was tried on a source file
-- earlier in this project and made things worse by mojibaking the correct parts.

do $$
declare
  bad text := U&'\00E2\20AC\201D';
  n_skills int;
  n_desc int;
  n_name int;
  n_detail int;
begin
  update public.agents
  set skills = (
    select array_agg(replace(s, bad, '-') order by ord)
    from unnest(skills) with ordinality as t(s, ord)
  )
  where skills is not null
    and exists (select 1 from unnest(skills) as s where position(bad in s) > 0);
  get diagnostics n_skills = row_count;

  update public.agents set description = replace(description, bad, '-')
  where position(bad in description) > 0;
  get diagnostics n_desc = row_count;

  update public.agents set name = replace(name, bad, '-')
  where position(bad in name) > 0;
  get diagnostics n_name = row_count;

  update public.probe_events set detail = replace(detail, bad, '-')
  where position(bad in detail) > 0;
  get diagnostics n_detail = row_count;

  raise notice 'mojibake repaired: skills=% description=% name=% probe_events=%',
    n_skills, n_desc, n_name, n_detail;
end $$;
