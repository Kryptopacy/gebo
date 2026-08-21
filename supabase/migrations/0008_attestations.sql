-- GEBO 0008 - attestations: feedback that requires proof of interaction.
--
-- Automated probing proves an agent ANSWERS. It cannot prove the agent does the
-- job well, and that gap is where every existing reputation system fails.
--
-- The naive fix - let people leave reviews - imports the disease this project
-- diagnoses. In the largest comparable marketplace, rating value correlated
-- about zero with actual usage. ERC-8004's own specification refuses unfiltered
-- aggregation: getSummary REQUIRES a non-empty clientAddresses filter because
-- otherwise it is Sybil-farmable. And the ecosystem already demonstrates the
-- failure, with one testnet generating roughly four fifths of all ERC-8004
-- feedback.
--
-- So an attestation is not an opinion. It is a claim ANCHORED to a verifiable
-- interaction, and an address with no interaction cannot leave one. That turns
-- reputation from an opinion market into an evidence ledger, which is what users
-- asked for: proof of performance from verified real work, not stars.

create table if not exists public.attestations (
  id                bigint generated always as identity primary key,

  chain_id          integer not null default 56,
  token_id          bigint  not null,

  -- Who is attesting. Either a wallet, or GEBO itself for tasks it ran.
  attester          text    not null,
  attester_kind     text    not null,   -- wallet | agent | gebo

  -- The evidence. Without one of these the row must not exist.
  evidence_kind     text    not null,   -- session_execution | erc8183_job | x402_payment | gebo_task
  evidence_ref      text    not null,   -- tx hash, job id, payment id, or task id
  evidence_verified boolean not null default false,
  evidence_checked_at timestamptz,

  -- The outcome, in the terms the task was set. Deliberately NOT a star rating.
  outcome           text    not null,   -- succeeded | partial | failed | disputed
  task              text,               -- what was asked
  result            text,               -- what came back
  /** Measured, not felt: seconds elapsed and cost paid, where known. */
  duration_ms       integer,
  cost_amount       numeric(38, 0),
  cost_token        text,

  -- Optional counterfactual: the same task done without an agent.
  baseline_duration_ms integer,
  baseline_cost_amount numeric(38, 0),
  baseline_note        text,

  -- Written to the ERC-8004 Reputation Registry, when it has been.
  onchain_tx        text,
  onchain_at        timestamptz,

  created_at        timestamptz not null default now(),

  -- Evidence is mandatory and must be one of the recognised kinds.
  constraint attestations_evidence_kind_ck
    check (evidence_kind in ('session_execution', 'erc8183_job', 'x402_payment', 'gebo_task')),
  constraint attestations_outcome_ck
    check (outcome in ('succeeded', 'partial', 'failed', 'disputed')),
  constraint attestations_attester_kind_ck
    check (attester_kind in ('wallet', 'agent', 'gebo')),
  -- A reference cannot be empty: an attestation with no anchor is an opinion.
  constraint attestations_evidence_ref_ck
    check (length(btrim(evidence_ref)) > 0),
  -- One attestation per interaction, so the same transaction cannot be counted twice.
  constraint attestations_unique_evidence
    unique (chain_id, token_id, evidence_kind, evidence_ref)
);

create index if not exists attestations_agent_idx    on public.attestations (chain_id, token_id, created_at desc);
create index if not exists attestations_attester_idx on public.attestations (attester);
create index if not exists attestations_verified_idx on public.attestations (evidence_verified) where evidence_verified;
create index if not exists attestations_pending_onchain_idx
  on public.attestations (created_at) where onchain_tx is null and evidence_verified;

alter table public.attestations enable row level security;
drop policy if exists attestations_public_read on public.attestations;
create policy attestations_public_read on public.attestations
  for select to anon, authenticated using (true);

-- Reviewer trust set. ERC-8004's getSummary requires filtering by client address,
-- so this is the filter. Seeded with GEBO's own prober and grown only on evidence.
alter table public.reviewers
  add column if not exists label text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists attestation_count integer not null default 0;

/**
 * Per-agent attestation summary.
 *
 * Deliberately returns counts by outcome and evidence kind rather than an
 * average. There is no star rating here and no single number to game: a reader
 * sees how many verified interactions succeeded, and can weigh evidence kinds
 * differently if they wish.
 */
create or replace function public.attestation_summary(p_chain integer, p_token bigint)
returns table (
  total            integer,
  verified         integer,
  succeeded        integer,
  partial          integer,
  failed           integer,
  disputed         integer,
  distinct_attesters integer,
  trusted_attesters  integer,
  evidence_kinds   jsonb,
  median_duration_ms integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::int,
    count(*) filter (where a.evidence_verified)::int,
    count(*) filter (where a.outcome = 'succeeded')::int,
    count(*) filter (where a.outcome = 'partial')::int,
    count(*) filter (where a.outcome = 'failed')::int,
    count(*) filter (where a.outcome = 'disputed')::int,
    count(distinct a.attester)::int,
    count(distinct a.attester) filter (
      where exists (select 1 from reviewers r where r.address = a.attester and r.trusted)
    )::int,
    coalesce(jsonb_object_agg(k.evidence_kind, k.n) filter (where k.evidence_kind is not null), '{}'::jsonb),
    percentile_disc(0.5) within group (order by a.duration_ms)::int
  from attestations a
  left join (
    select evidence_kind, count(*)::int as n
    from attestations
    where chain_id = p_chain and token_id = p_token
    group by evidence_kind
  ) k on true
  where a.chain_id = p_chain and a.token_id = p_token;
$$;
