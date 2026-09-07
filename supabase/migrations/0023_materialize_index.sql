-- GEBO 0023 — indexes the materialize candidate scan.
--
-- The every-minute materialize cron selects its candidates with
-- resolved/has_name/token_uri filters plus a NOT EXISTS against agents -
-- a 50s+ scan when the pooler is contended and the tables are 337k/100k+
-- rows. A partial index on the resolved+named+uri-bearing slice turns the
-- candidate scan into an index walk.
create index if not exists registry_tokens_materialize_idx
  on public.registry_tokens (token_id)
  where resolved and has_name and token_uri is not null;

-- The agents existence check is by (chain_id, token_id): that is the
-- primary key, but the census NOT EXISTS benefits from having the leading
-- column order the probe uses too. The PK already covers it; this adds
-- nothing and is deliberately omitted.
