-- GEBO 0017 - verified reviews: the L1 amendment (2026-08-31), built.
--
-- The GPT Store autopsy (rating/usage correlation straddling zero) measures
-- UNANCHORED ratings - self-selected raters with no proof of use. It does not
-- condemn reviews; it locates where review information actually lives: in
-- comments from wallets that provably completed a job.
--
-- The gate is the expensive door, by design:
--   an x402 call costs 0.01 $U, so interaction-gated reviews are Sybil-cheap;
--   a COMPLETED APEX (ERC-8183) escrow job costs ~7 transactions, gas, and
--   surviving a dispute window.
-- "Proven" here is verified on chain at write time: job status Completed,
-- client = reviewer, provider = the agent. Never a claim taken on trust.
--
-- Comments, not numbers: no stars, no score, no aggregate, and nothing that
-- can feed a ranking (the count variant is blocked independently by L3,
-- because review count tracks hire volume, not quality). The comment carries
-- the one dimension neither probes (liveness) nor the APEX evaluator
-- (mechanical completion) can measure - did it do what the brief said.
--
-- The anchor is on-chain (jobId, read block recorded as evidence); the text is
-- off-chain, because on-chain text is undeletable and at our hire volumes one
-- angry review is 33-100% of the visible signal. One review per job: the
-- unique constraint is the anti-double-count.

create table if not exists public.verified_reviews (
  id             bigint generated always as identity primary key,

  chain_id       integer not null,         -- APEX deployment the job lives on (56 | 97)
  job_id         bigint  not null,         -- APEX escrow job id - the on-chain anchor
  token_id       bigint  not null,         -- the agent that was hired (ERC-8004, registry chain 56)

  reviewer       text    not null,         -- the job's client, read from chain at verification
  comment        text    not null,         -- free text, 16..2000 chars

  job_status     smallint not null,        -- APEX status at verification time (3 = Completed)
  checked_block  bigint  not null,         -- block the gate was verified at
  created_at     timestamptz not null default now(),

  constraint verified_reviews_comment_ck
    check (char_length(comment) between 16 and 2000),
  constraint verified_reviews_one_per_job
    unique (chain_id, job_id)
);

create index if not exists verified_reviews_agent_idx
  on public.verified_reviews (token_id, created_at desc);

alter table public.verified_reviews enable row level security;
drop policy if exists verified_reviews_public_read on public.verified_reviews;
create policy verified_reviews_public_read on public.verified_reviews
  for select to anon, authenticated using (true);
-- No insert policy: writes arrive only through the app's verification path
-- (wallet signature + on-chain completed-job check) on the service connection,
-- mirroring how the cron jobs write their tables.
