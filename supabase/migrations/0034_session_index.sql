-- GEBO 0034 - Keystore session index: third-party sessions in public.sessions.
--
-- Until now the table held only GEBO's own demo grants, and AGENTS.md
-- recorded the gap plainly: "no reverse index from session key to wallet...
-- public.sessions was designed for exactly that and is still empty."
--
-- The index works WITHOUT guessing the Keystore's event ABI (the SDK ships
-- none): logs are only the discovery layer - topic1-shaped wallets - and
-- the truth per wallet comes from getKeys/isValidKey/getPublicKey through
-- the same readAuthority() the authority console uses.
--
-- source separates rows by origin. grant_tx_hash and expiry stay NULL on
-- chain-index rows, which keeps them out of the demo-grants list (filtered
-- on expiry > now()) and the readiness Altana gate (filtered on
-- grant_tx_hash is not null) - both of those mean OUR grants, and mixing
-- third-party sessions into them would inflate evidence.
--
-- index_checkpoints carries the bounded getLogs window per indexer. RLS
-- enabled with no policy: internal-only.
alter table public.sessions
  add column if not exists source text not null default 'gebo-grant',
  add column if not exists first_seen_block bigint,
  add column if not exists last_seen_block bigint,
  add column if not exists last_checked_at timestamptz;

create table if not exists public.index_checkpoints (
  name       text primary key,
  last_block bigint not null,
  updated_at timestamptz not null default now()
);
alter table public.index_checkpoints enable row level security;

-- Every 10 minutes, offset from the busier on-the-minute jobs.
select cron.schedule('gebo-sessions', '4,14,24,34,44,54 * * * *',
  $$select public.gebo_run_cron('/api/cron/sessions')$$);
