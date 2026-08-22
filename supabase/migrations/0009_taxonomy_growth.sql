-- GEBO 0009 - a taxonomy that can grow, and a classifier that terminates.
--
-- Capability classification is nine hand-written rule sets. That is honest for
-- today's corpus, where the four judged categories are almost unserved, but it is
-- not a resting state: the ecosystem will produce capabilities nobody has named
-- yet, and this product claims to be the front door for all of them. Two defects
-- stood in the way of growing safely.
--
-- ONE: A RULE EDIT DID NOT INVALIDATE ANYTHING. Reclassification triggered only
-- when an agent card was refetched (0007), so correcting a rule left every
-- already-classified agent holding a label the current rules would not produce,
-- with no record of which rules produced it. The taxonomy could not be changed
-- without a manual full rescan somebody had to remember to run.
--
-- TWO: THE CLASSIFIER NEVER FINISHED. Its work queue selected `category is null`,
-- which stays true for an agent that legitimately matches nothing. Roughly 21,000
-- unmatched agents therefore re-qualified on every ten-minute run, were rewritten
-- with identical values, and the backlog could never drain. `stillUnclassified`
-- was structurally incapable of falling.
--
-- classify_rules fixes both. It stores the fingerprint of the rule sets that
-- examined the agent, derived in src/lib/classify.ts from RULES itself rather than
-- declared by hand, because a version string somebody must remember to bump is a
-- discipline problem and a stale one asserts a freshness that does not hold.
--
--   * an unmatched agent records the fingerprint and stops re-qualifying
--   * editing any rule changes the fingerprint, so every agent re-qualifies
--     automatically and the taxonomy becomes safe to grow
--   * a listing can state which rules produced its label

alter table public.agents
  add column if not exists classify_rules text;

/**
 * Drives the classifier's work queue.
 *
 * Replaces agents_needs_classify_idx from 0007, whose `where category is null`
 * predicate is exactly the busy-loop described above. Kept broad rather than
 * partial: the queue is now "fingerprint differs from current", and the current
 * value changes on every rule edit, so no partial predicate stays valid.
 */
create index if not exists agents_classify_rules_idx
  on public.agents (chain_id, classify_rules);

drop index if exists public.agents_needs_classify_idx;

-- Agents already classified under the hand-written rules predate fingerprinting.
-- Left null deliberately: null differs from any fingerprint, so the next run
-- re-examines them once and records what examined them. One catch-up pass, then
-- the queue is empty until rules change or a card is refetched.

/**
 * Emerging-capability candidates.
 *
 * The detector in src/lib/emerging.ts finds terms in unclassified agents that no
 * rule covers. It ran only when a human executed a script and printed to a
 * terminal, so a new capability on BNB Chain produced silence. Persisting the
 * findings is what turns detection from an errand into a standing measurement.
 *
 * PROMOTION STAYS HUMAN. Auto-creating a category from term frequency produces
 * garbage, and this is measured rather than assumed: frequency alone nominated
 * `unibase`, which is an operator and not a job, and `swan`, which came from one
 * poetic sentence repeated across mass-minted identities. The most common terms in
 * the corpus are `bsc`, `defi` and `agent` - venue and buzzword noise. An
 * automatic taxonomy would spawn a `defi` category holding thousands of unrelated
 * agents, which is worse than leaving them unclassified because it looks
 * authoritative. So this table holds candidates and their evidence, and a person
 * decides.
 *
 * The judged four are closed. They are fixed externally by the BNB Agent Studio
 * rubric, and a candidate may only ever become an adjacent category: promoting
 * detected behaviour into a judged tier is the same inflation that narrowing the
 * grid and yield rules removed.
 */
create table if not exists public.category_candidates (
  term              text    not null,
  chain_id          integer not null default 56,

  -- Evidence. Counted over DISTINCT capability texts, never over agents: mass
  -- minting means one author's single sentence can appear on hundreds of
  -- identities, and counting agents treated that as hundreds of observations.
  distinct_texts    integer not null,
  verified_texts    integer not null,
  /**
   * Independent operators using the term, and the decisive filter.
   *
   * `unibase` was nominated on 17 verified texts and is an operator, not a job.
   * One operator's vocabulary is branding; a capability is something at least two
   * independent parties describe in the same words. That is what a category
   * means, so it is what a candidate must show.
   */
  distinct_operators integer not null default 1,
  example_agents    text[]  not null default '{}',

  -- Which rule fingerprint was in force when this was judged uncovered. A term
  -- nominated under old rules may already be covered by new ones.
  rules_fingerprint text    not null,

  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),

  -- Triage. Set by a person, never by the detector.
  status            text    not null default 'candidate',
  decided_at        timestamptz,
  decided_note      text,

  primary key (chain_id, term),

  constraint category_candidates_status_ck
    check (status in ('candidate', 'promoted', 'rejected', 'noise')),
  -- A candidate with no evidence is a guess. Three distinct texts is the floor,
  -- and two independent operators is the bar that actually did the work.
  constraint category_candidates_evidence_ck
    check (distinct_texts >= 3 and distinct_operators >= 2)
);

-- Added after the table shipped, so existing deployments gain the column rather
-- than needing a rebuild.
alter table public.category_candidates
  add column if not exists distinct_operators integer not null default 1;

create index if not exists category_candidates_rank_idx
  on public.category_candidates (chain_id, verified_texts desc, distinct_texts desc)
  where status = 'candidate';

alter table public.category_candidates enable row level security;
drop policy if exists category_candidates_public_read on public.category_candidates;
/**
 * Public read is the point, not an afterthought.
 *
 * Publishing "capabilities we can see but have not named yet" is the same move as
 * publishing the prober's single-region defect: a measurement whose limits are
 * visible is evidence, and one whose limits are hidden is marketing. It also
 * states plainly that the taxonomy is incomplete, which is true of every taxonomy
 * and admitted by almost none.
 */
create policy category_candidates_public_read on public.category_candidates
  for select to anon, authenticated using (true);

-- Daily, not every ten minutes. This scans the unclassified corpus and collapses
-- duplicate text; it is comparatively expensive and a new capability category
-- does not emerge on a ten-minute cadence. 03:17 UTC to avoid the top of the hour
-- where the other five jobs cluster.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gebo-emerging') then
    perform cron.unschedule('gebo-emerging');
  end if;
end $$;

select cron.schedule('gebo-emerging', '17 3 * * *',
  $$select public.gebo_run_cron('/api/cron/emerging')$$);
