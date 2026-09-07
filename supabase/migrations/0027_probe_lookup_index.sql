-- GEBO 0027 - the latest-probe lookup index.
--
-- Every agent card, search-result row and the probe cron's due-endpoint
-- query ask "most recent probes_raw row for this endpoint" (where
-- endpoint_id = X order by at desc limit 1). probes_raw had NO endpoint_id
-- index - each lookup seq-scanned the 48h window (~21k rows, growing with
-- endpoint count), sixty times per search page and on every probe batch.
create index concurrently if not exists probes_raw_endpoint_idx
  on public.probes_raw (endpoint_id, at desc);
