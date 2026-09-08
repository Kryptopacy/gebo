import { getClient } from "@/db";
import {
  HEALTH_ACT_UTILISATION, HEALTH_WATCH_UTILISATION, PAPER_SCOPE_NOTE,
} from "@/lib/paper";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Paper mode — GEBO" };

type Run = {
  id: number;
  started_at: Date;
  decisions_n: number;
  scored_n: number;
  correct_n: number;
};
type Decision = {
  id: number;
  subject_id: string;
  decision: string;
  inputs: { utilisation?: number; readAtBlock?: string } | null;
  decided_at: Date;
  scored_at: Date | null;
  outcome: string | null;
};

async function loadPaper(): Promise<{ runs: Run[]; latest: Decision[]; error: string | null }> {
  const sql = getClient();
  if (!sql) return { runs: [], latest: [], error: "no database connection" };
  try {
    const runs = await sql<Run[]>`
      select id, started_at, decisions_n, scored_n, correct_n
      from paper_runs order by id desc limit 10`;
    const latest = runs.length
      ? await sql<Decision[]>`
          select id, subject_id, decision, inputs, decided_at, scored_at, outcome
          from paper_decisions where run_id = ${runs[0]!.id}
          order by subject_id`
      : [];
    return { runs, latest, error: null };
  } catch (e) {
    return { runs: [], latest: [], error: String((e as Error).message ?? e).slice(0, 140) };
  }
}

/**
 * Paper mode, publicly visible (spec: Tier 3 on-ramp). The reference health
 * agent's real decision loop runs daily under a zero-spend, read-only scope;
 * every decision is recorded on its measured inputs and scored mechanically
 * on the next run.
 *
 * What this page may never become: a rating. The score is a fraction with
 * its counts and its rule, over a stated window - evidence about decision
 * quality, not a rank, not a star, not a sort key (invariant 2).
 */
export default async function PaperPage() {
  const { runs, latest, error } = await loadPaper();
  const totalScored = runs.reduce((a, r) => a + r.scored_n, 0);
  const totalCorrect = runs.reduce((a, r) => a + r.correct_n, 0);

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Paper mode</p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.6rem)" }}>
              Decisions before money
            </h1>
            <p className="standfirst">
              An unproven agent&apos;s on-ramp (spec Tier 3): the reference health agent runs its
              real decision loop under a zero-spend scope, and every decision is recorded on its
              measured inputs and scored mechanically on the next run.
            </p>
          </div>
          <div className="surface-card mt-m" style={{ padding: "14px 18px" }}>
            <p className="section-label">Scope</p>
            <p className="prose sm" style={{ margin: 0 }}>{PAPER_SCOPE_NOTE}</p>
            <p className="section-label" style={{ marginTop: 14 }}>Scoring rule</p>
            <p className="prose sm" style={{ margin: 0 }}>
              An <span className="num">act</span> or <span className="num">watch</span> call is
              correct when utilisation rises at least 2 points by the next run; an{" "}
              <span className="num">ok</span> call is correct when utilisation stays below the{" "}
              watch threshold ({(HEALTH_WATCH_UTILISATION * 100).toFixed(0)}%). Decisions whose
              market disappears stay unscored rather than counting as wrong. Thresholds: watch at{" "}
              {(HEALTH_WATCH_UTILISATION * 100).toFixed(0)}%, act at{" "}
              {(HEALTH_ACT_UTILISATION * 100).toFixed(0)}% utilisation.
            </p>
          </div>
          {error && (
            <div className="notice mt-m" data-tone="fail">
              <strong>The paper record could not be read.</strong> <span className="sm">{error}</span>
            </div>
          )}
        </div>
      </section>

      <section className="band">
        <div className="shell">
          <h2>
            {runs.length === 0
              ? "No paper run has executed yet"
              : `Latest run — ${runs.length} run${runs.length === 1 ? "" : "s"} recorded`}
          </h2>
          {runs.length === 0 && !error ? (
            <div className="surface-card mt-m">
              <p className="prose sm" style={{ margin: 0 }}>
                The paper cron fires daily at 03:13 UTC. Until the first run, this page holds the
                explicit empty state rather than zeros - nothing has been measured yet.
              </p>
            </div>
          ) : (
            <>
              <div className="data-table-frame mt-m">
                <div className="rows">
                  <div className="rows-head r-agents">
                    <span>Market</span><span>Decision</span><span>Utilisation</span><span>Outcome</span>
                  </div>
                  {latest.map((d) => (
                    <div key={d.id} className="row r-agents">
                      <div>
                        <span className="sm">{d.subject_id}</span>
                        <div className="xs t-4 num">
                          block {Number(d.inputs?.readAtBlock ?? 0).toLocaleString()} ·{" "}
                          {new Date(d.decided_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                        </div>
                      </div>
                      <div>
                        <span
                          className="chip"
                          data-state={d.decision === "ok" ? "DORMANT" : d.decision === "watch" ? "LISTED" : "VERIFIED"}
                        >
                          {d.decision.toUpperCase()}
                        </span>
                      </div>
                      <div className="num xs t-3">
                        {d.inputs?.utilisation != null ? `${(d.inputs.utilisation * 100).toFixed(1)}%` : "—"}
                      </div>
                      <div className="xs t-3">
                        {d.outcome ?? "pending next run"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <h2 className="mt-l">Scored record</h2>
              <p className="prose sm">
                {totalScored > 0 ? (
                  <>
                    <strong>{totalCorrect} of {totalScored}</strong> scored decisions were correct
                    across the last {runs.length} run{runs.length === 1 ? "" : "s"}
                    {" "}({((totalCorrect / totalScored) * 100).toFixed(0)}%), under the scoring
                    rule above. This is a count with its denominator, not a rating.
                  </>
                ) : (
                  <>No decision has been scored yet - scoring happens on the run after the decision.</>
                )}
              </p>
              {runs.length > 1 && (
                <div className="data-table-frame mt-m">
                  <div className="rows">
                    <div className="rows-head r-agents">
                      <span>Run</span><span>Decisions</span><span>Scored</span><span>Correct</span>
                    </div>
                    {runs.map((r) => (
                      <div key={r.id} className="row r-agents">
                        <div className="num xs">#{r.id} · {new Date(r.started_at).toISOString().slice(0, 10)}</div>
                        <div className="num xs">{r.decisions_n}</div>
                        <div className="num xs">{r.scored_n}</div>
                        <div className="num xs">{r.scored_n > 0 ? `${r.correct_n}/${r.scored_n}` : "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="band band-last">
        <div className="shell">
          <h2>What this is not</h2>
          <div className="surface-card mt-m">
            <p className="prose sm" style={{ margin: 0 }}>
              This is not a track record of executed work. No transaction was sent, no position was
              held, and no counterparty existed - the decisions are the agent&apos;s real loop on
              real state, scored in hindsight. A paper record graduates to the Verified on-ramp
              only through completed escrow work, never by accumulating paper score.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
