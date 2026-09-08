-- GEBO 0036 - paper mode: recorded, publicly scored decisions under a
-- zero-spend scope (spec: Tier 3 on-ramp, "paper-mode: the agent runs its
-- real decision loop with a zero-spend session, and its decisions are
-- recorded and scored publicly").
--
-- The subject for v1 is GEBO's reference health agent: its real decision
-- loop reads Venus market state and decides per market. The loop is
-- read-only by construction - the scope it needs is exactly the zero-spend
-- scope the spec describes, which the run row records rather than merely
-- asserts.
--
-- inputs is NOT NULL on paper_decisions: a decision without its measured
-- inputs (utilisation, thresholds, observation window) is an opinion, and
-- design law L2 says numbers do not travel naked. Scoring is mechanical
-- and disclosed: an "act"/"watch" call is correct when utilisation rose
-- >= 2 points by the next run; an "ok" call is correct when utilisation
-- stayed below the watch threshold. The score is a fraction with counts,
-- never a rating (invariant 2: no review-shaped numbers).
create table if not exists public.paper_runs (
  id           bigint generated always as identity primary key,
  subject      text not null,
  mode         text not null default 'paper',
  scope_note   text not null,
  decisions_n  integer not null default 0,
  scored_n     integer not null default 0,
  correct_n    integer not null default 0,
  started_at   timestamptz not null default now()
);

create table if not exists public.paper_decisions (
  id            bigint generated always as identity primary key,
  run_id        bigint not null references public.paper_runs (id),
  subject_id    text not null,
  decision      text not null,
  inputs        jsonb not null,
  decided_at    timestamptz not null default now(),
  scored_at     timestamptz,
  outcome       text,
  outcome_score real
);

create index if not exists paper_decisions_run_idx on public.paper_decisions (run_id);
create index if not exists paper_decisions_subject_idx on public.paper_decisions (subject_id, decided_at desc);

alter table public.paper_runs enable row level security;
drop policy if exists paper_runs_public_read on public.paper_runs;
create policy paper_runs_public_read on public.paper_runs
  for select to anon, authenticated using (true);
alter table public.paper_decisions enable row level security;
drop policy if exists paper_decisions_public_read on public.paper_decisions;
create policy paper_decisions_public_read on public.paper_decisions
  for select to anon, authenticated using (true);

-- Daily at 03:13 UTC: quiet hours for Venus state, and offset from every
-- other job's minute.
select cron.schedule('gebo-paper', '13 3 * * *',
  $$select public.gebo_run_cron('/api/cron/paper')$$);
