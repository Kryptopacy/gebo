-- GEBO 0014 - repair mojibake in probes_raw.evidence, the column the page reads.
--
-- 0013 cleaned agents.skills and reported success, and the page kept rendering the
-- corruption: 8 occurrences in production HTML alongside 22 correct em dashes. The
-- agent page reads the skill text out of the probe EVIDENCE json, not out of
-- agents.skills, and 19,550 probes_raw rows carried it.
--
-- The lesson worth keeping: cleaning the column you assumed was the source, then
-- declaring victory, is how a fix gets committed while the defect stays live. The DB
-- said zero and the page said eight; the page was right.
--
-- Also removes the belief that the terminal is a reliable witness here - PowerShell
-- renders correct UTF-8 as this same mojibake, so every check has to decode
-- explicitly rather than eyeball console output.

do $$
declare
  bad text := U&'\00E2\20AC\201D';
  n int;
begin
  update public.probes_raw
  set evidence = replace(evidence::text, bad, '-')::jsonb
  where position(bad in evidence::text) > 0;
  get diagnostics n = row_count;
  raise notice 'probes_raw.evidence repaired: % row(s)', n;
end $$;
