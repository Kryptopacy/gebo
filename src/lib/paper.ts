/**
 * Paper mode: the reference health agent's real decision loop, run under a
 * zero-spend scope, with every decision recorded on its measured inputs and
 * scored mechanically on the next run (spec: Tier 3 on-ramp).
 *
 * WHY THE SCOPE NOTE MATTERS. The spec's paper mode is "a zero-spend session
 * and recorded, scored decisions". The health loop is read-only by
 * construction - it decides, it does not transact - so the scope it needs is
 * literally zero-spend: no call targets, no spend caps. The run row records
 * that scope rather than asserting it, and the /paper surface prints it.
 *
 * SCORING IS MECHANICAL, DISCLOSED, AND NOT A RATING. An "act" or "watch"
 * call is correct when utilisation rose by >= 2 points by the next run; an
 * "ok" call is correct when utilisation stayed below the watch threshold.
 * The published figure is a fraction WITH ITS COUNTS (design law L2), and
 * nothing here may ever become a sort key or a star-shaped number
 * (invariant 2).
 */
import postgres from "postgres";

/** Utilisation thresholds, fixed and disclosed - not tuned per run. */
export const HEALTH_WATCH_UTILISATION = 0.85;
export const HEALTH_ACT_UTILISATION = 0.95;
/** A directional call is correct when utilisation moved at least this much. */
export const HEALTH_SCORE_DELTA = 0.02;

export const PAPER_SCOPE_NOTE =
  "zero-spend read-only scope: no call targets, no spend caps - the loop reads Venus " +
  "market state and records decisions; executing any of them would require a session " +
  "the paper mode never holds";

export type HealthDecision = "ok" | "watch" | "act";

export type DecisionInputs = {
  utilisation: number;
  cash: string;
  totalBorrows: string;
  watchThreshold: number;
  actThreshold: number;
  readAtBlock: string;
};

/** The decision rule, pure: high utilisation means thin liquidity for
 *  withdrawals and outsized liquidation pressure - the thing a health agent
 *  exists to watch. */
export function decideHealth(utilisation: number): HealthDecision {
  if (utilisation >= HEALTH_ACT_UTILISATION) return "act";
  if (utilisation >= HEALTH_WATCH_UTILISATION) return "watch";
  return "ok";
}

export type ScoredDecision = {
  outcome: "correct" | "incorrect" | "unresolved";
  score: number | null;
};

/** Score one past decision against the current state. Pure. */
export function scoreDecision(
  decision: HealthDecision,
  thenUtilisation: number,
  nowUtilisation: number,
): ScoredDecision {
  const rose = nowUtilisation - thenUtilisation;
  if (decision === "act" || decision === "watch") {
    const correct = rose >= HEALTH_SCORE_DELTA;
    return { outcome: correct ? "correct" : "incorrect", score: correct ? 1 : 0 };
  }
  // "ok" is correct when the warning never became warranted.
  const correct = nowUtilisation < HEALTH_WATCH_UTILISATION;
  return { outcome: correct ? "correct" : "incorrect", score: correct ? 1 : 0 };
}

export type PaperRunSummary = {
  runId: number;
  decisions: number;
  scored: number;
  correct: number;
};

/**
 * One paper cycle: score the previous run's unscored decisions against the
 * fresh state, then record a new run of decisions. Writing happens only
 * through the passed sql handle; the chain reads are the caller's job.
 */
export async function recordPaperCycle(
  sql: ReturnType<typeof postgres>,
  freshMarkets: { subjectId: string; utilisation: number; cash: string; totalBorrows: string; readAtBlock: string }[],
): Promise<PaperRunSummary> {
  const nowBySubject = new Map(freshMarkets.map((m) => [m.subjectId, m]));

  // 1. Score the previous run's unscored decisions against the fresh state.
  const prev = await sql<{ id: number; subject_id: string; decision: string; inputs: any }[]>`
    select d.id, d.subject_id, d.decision, d.inputs
    from paper_decisions d
    join paper_runs r on r.id = d.run_id
    where r.subject = 'reference-health'
      and d.scored_at is null
      and d.decided_at < now() - interval '2 hours'`;
  let scored = 0;
  let correct = 0;
  for (const d of prev) {
    const nowState = nowBySubject.get(d.subject_id);
    // The stored inputs may arrive double-encoded (a JSON string inside jsonb,
    // the invariant-10 shape) depending on how the row was written; unwrap
    // either shape before reading a value, and skip rather than zero when
    // neither yields a finite utilisation.
    const raw = typeof d.inputs === "string" ? JSON.parse(d.inputs) : d.inputs;
    const thenUtil = Number(raw?.utilisation);
    if (!nowState || !Number.isFinite(thenUtil)) continue; // market gone: stays unscored, not zero
    const s = scoreDecision(d.decision as HealthDecision, thenUtil, nowState.utilisation);
    await sql`
      update paper_decisions set scored_at = now(), outcome = ${s.outcome}, outcome_score = ${s.score}
      where id = ${d.id}`;
    scored++;
    if (s.score === 1) correct++;
  }

  // 2. Record the new run.
  const [run] = await sql<{ id: number }[]>`
    insert into paper_runs (subject, mode, scope_note, decisions_n)
    values ('reference-health', 'paper', ${PAPER_SCOPE_NOTE}, ${freshMarkets.length})
    returning id`;
  for (const m of freshMarkets) {
    const inputs: DecisionInputs = {
      utilisation: m.utilisation, cash: m.cash, totalBorrows: m.totalBorrows,
      watchThreshold: HEALTH_WATCH_UTILISATION, actThreshold: HEALTH_ACT_UTILISATION,
      readAtBlock: m.readAtBlock,
    };
    // jsonb as an OBJECT: passing a pre-stringified value into jsonb
    // double-encodes it (jsonb_typeof = 'string'), and every downstream
    // read then misses its keys. sql.json() is the codebase's typed
    // jsonb-parameter form (metrics.ts, grid-record-run.ts).
    await sql`
      insert into paper_decisions (run_id, subject_id, decision, inputs)
      values (${run!.id}, ${m.subjectId}, ${decideHealth(m.utilisation)}, ${sql.json(inputs)}::jsonb)`;
  }
  if (scored > 0) {
    // Attribute the scoring to the run whose decisions were scored, not to
    // this run. The max(id) form credited the run that just started, whose
    // decisions are by definition unscored - so the summary landed on the
    // wrong row every cycle.
    await sql`
      update paper_runs r set scored_n = ${scored}, correct_n = ${correct}
      where id = (
        select min(d.run_id) from paper_decisions d
        join paper_runs pr on pr.id = d.run_id
        where d.scored_at >= now() - interval '1 hour'
          and pr.scored_n = 0
      )`;
  }

  return { runId: run!.id, decisions: freshMarkets.length, scored, correct };
}
