-- GEBO 0004 — store the metadata pointer alongside each token.
--
-- The remote resolution pass needs to know which URL to fetch. Without the
-- pointer stored, a scheduled job would have to re-read tokenURI from chain for
-- every pending token (~100k calls, roughly 45 minutes) before it could fetch
-- anything. One text column removes that entirely.
--
-- Cost is about 22 MB at 270k rows, against an 80 MB current size and a 500 MB
-- ceiling — a good trade for making resolution schedulable.

alter table public.registry_tokens
  add column if not exists token_uri text,
  add column if not exists resolve_error text,
  add column if not exists resolve_attempts smallint not null default 0;

-- Drives the resolver's work queue: unresolved, remotely-hosted, not yet
-- retried to exhaustion. Partial index so it stays small as coverage grows.
create index if not exists registry_tokens_pending_idx
  on public.registry_tokens (resolve_attempts, token_id)
  where resolved = false and uri_scheme in ('https', 'http', 'ipfs');
