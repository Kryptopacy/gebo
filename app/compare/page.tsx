import { taskRuns } from "@/lib/attestations";
import { computeAdvantage, reportGaps, toTokens, humanMs } from "@/lib/advantage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Did hiring the agent beat doing it yourself? - GEBO",
  description:
    "Every task we have run both ways, with the manual arm timed and costed alongside the agent. Failures included in the totals.",
};

/**
 * The counterfactual surface.
 *
 * Liveness proves an agent answers and authority proves what it may touch. Neither
 * says whether the hire was worth it, which is the question anyone actually
 * deciding has. This page answers it only where both arms of the comparison were
 * measured, and says so plainly where they were not.
 *
 * WHAT THIS PAGE REFUSES TO DO.
 *
 * It does not average away failures. An agent that ran, charged, and returned
 * nothing usable is in the totals at full weight, because excluding it is the
 * standard way a benchmark is made to flatter its subject. The successful subset is
 * shown alongside, labelled, so a reader can see the gap between the two rather
 * than being handed whichever number looks better.
 *
 * It does not turn three runs into a claim about agents. Under ten observations the
 * aggregate is presented as a description of these specific runs and nothing wider.
 *
 * It does not hide a negative result. If the manual path won, that is what renders.
 */
function pct(n: number | null): string {
  if (n == null) return "\u2014";
  const s = n >= 0 ? "" : "\u2212";
  return `${s}${Math.abs(n).toFixed(1)}%`;
}

const OUTCOME_TONE: Record<string, string> = {
  succeeded: "pass",
  partial: "hold",
  failed: "fail",
  disputed: "fail",
};

export default async function ComparePage() {
  const { runs, unavailable, reason } = await taskRuns(56, 100);
  const a = computeAdvantage(runs);
  const gaps = reportGaps(a);

  const header = (
    <section className="band-tight">
      <div className="shell">
        <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Compare</p>
        <div className="headline-pair">
          <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.6rem)" }}>
            Did hiring the agent beat doing it yourself?
          </h1>
          <p className="standfirst">
            Every task we have run both ways, with the manual arm timed and costed beside
            the agent. Failed runs stay in the totals, because dropping them is how a
            benchmark is made to flatter what it sells.
          </p>
        </div>
      </div>
    </section>
  );

  /**
   * A failed read is not a finding of zero. Same rule as the liveness ledger,
   * which once printed "0 probes across 0 endpoints" against a database holding
   * 43,456 of them.
   */
  if (unavailable) {
    return (
      <>
        {header}
        <section className="band band-last">
          <div className="shell">
            <div className="notice" data-tone="fail">
              <strong>The comparison ledger could not be read.</strong> This is a failure
              to measure, not a finding that no comparisons exist, so no figures are
              shown.
            </div>
            {reason && (
              <p className="prose sm mt-m">
                Reported cause: <span className="num">{reason}</span>
              </p>
            )}
          </div>
        </section>
      </>
    );
  }

  if (!runs.length) {
    return (
      <>
        {header}
        <section className="band band-last">
          <div className="shell">
            <div className="surface-card">
              <h2>No task has been run both ways yet</h2>
              <p className="prose sm">
                This page reports only tasks where the same job was done twice: once by
                an agent, once without one, both timed. Nothing qualifies yet, and an
                empty table is the honest state rather than a placeholder.
              </p>
              <p className="prose sm">
                An attestation counts here only when it carries a baseline. Most will
                not: a session execution proves an agent did something, not what the
                alternative would have cost. We do not infer a baseline, because an
                invented one is the easiest place to manufacture an advantage.
              </p>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {header}

      <section className="band-tight">
        <div className="shell">
          <dl className="kpi-grid">
            <div className="kpi-card">
              <dt>Tasks run both ways</dt>
              <dd>{a.runs}</dd>
              <div className="qualifier">
                {a.succeeded} succeeded, {a.partial} partial, {a.failed} failed
                {a.disputed > 0 ? `, ${a.disputed} disputed` : ""}. {a.verifiedRuns} with
                verified evidence
              </div>
            </div>

            <div className="kpi-card">
              <dt>Time the agent saved</dt>
              <dd
                style={{
                  fontSize: "1.45rem",
                  color: a.netTimeSavedMs > 0 ? "var(--pass)" : a.netTimeSavedMs < 0 ? "var(--fail)" : undefined,
                }}
              >
                {a.netTimeSavedMs >= 0 ? "" : "\u2212"}
                {humanMs(Math.abs(a.netTimeSavedMs))}
                <span className="t-4" style={{ fontSize: "0.85rem" }}> {pct(a.timeSavedPct)}</span>
              </dd>
              <div className="qualifier">
                {humanMs(a.agentTotalMs)} with an agent against {humanMs(a.manualTotalMs)}{" "}
                without, across {a.timedBoth} run{a.timedBoth === 1 ? "" : "s"} timed on
                both arms. Failures included
              </div>
            </div>

            <div className="kpi-card">
              <dt>What the agent cost</dt>
              <dd style={{ fontSize: "1.45rem" }}>
                {a.pricedBoth === 0
                  ? "\u2014"
                  : `${toTokens(a.agentTotalCost)?.toFixed(4) ?? "\u2014"}`}
                {a.pricedBoth > 0 && (
                  <span className="t-4" style={{ fontSize: "0.85rem" }}> tokens</span>
                )}
              </dd>
              <div className="qualifier">
                {a.pricedBoth === 0
                  ? "No run recorded a cost on both arms"
                  : `Across ${a.pricedBoth} priced run${a.pricedBoth === 1 ? "" : "s"}. The manual arm cost ${toTokens(a.manualTotalCost)?.toFixed(4)}, so the agent path was ${a.netCostSaved >= 0n ? "cheaper" : "dearer"} by ${Math.abs(toTokens(a.netCostSaved) ?? 0).toFixed(4)}`}
              </div>
            </div>

            <div className="kpi-card">
              <dt>Successful runs only</dt>
              <dd style={{ fontSize: "1.45rem" }}>
                {a.successOnlyTimeSavedPct == null ? "\u2014" : pct(a.successOnlyTimeSavedPct)}
              </dd>
              <div className="qualifier">
                Shown for contrast with the figure beside it, never instead of it.
                Reporting only this is how an agent benchmark is made to look good
              </div>
            </div>
          </dl>

          {a.smallSample && (
            <div className="notice mt-m" data-tone="hold">
              <strong>
                {a.runs} run{a.runs === 1 ? "" : "s"} is not a sample.
              </strong>{" "}
              These totals describe exactly these tasks, on the days they ran, against
              these agents. They do not support a claim about agents in general, and are
              not presented as one. The threshold for generalising here is ten
              observations.
            </div>
          )}

          {gaps.length > 0 && (
            <div className="notice mt-m" data-tone="fail">
              <strong>This ledger is incomplete.</strong> Published anyway, because
              stating what is missing is worth more than waiting until it looks finished:
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
                {gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="band">
        <div className="shell">
          <div className="headline-pair">
            <h2>01 &middot; Every run, including the ones that went badly</h2>
            <p className="prose sm">
              One row per task. The manual arm is what the same job took without an
              agent, and how it was done is stated so the baseline can be argued with.
              A run that failed still occupies its full weight in the totals above.
            </p>
          </div>

          <div className="data-table-frame mt-l">
            <div className="rows">
              <div
                className="rows-head"
                style={{ gridTemplateColumns: "minmax(0,1.5fr) 8rem 7rem 7rem 7rem" }}
              >
                <span>Task</span>
                <span>Outcome</span>
                <span style={{ textAlign: "right" }}>With agent</span>
                <span style={{ textAlign: "right" }}>By hand</span>
                <span style={{ textAlign: "right" }}>Saved</span>
              </div>

              {a.perRun.map((c) => {
                const r = c.run;
                const tone = OUTCOME_TONE[r.outcome] ?? "hold";
                return (
                  <div
                    key={`${r.tokenId}-${r.evidenceRef}`}
                    className="row"
                    style={{ gridTemplateColumns: "minmax(0,1.5fr) 8rem 7rem 7rem 7rem" }}
                  >
                    <div>
                      <h3>{r.task}</h3>
                      <div className="xs t-4">
                        <a href={`/a/${r.tokenId}`}>
                          {r.agentName ?? `Agent ${r.tokenId}`}
                        </a>
                        {" \u00b7 "}
                        <span className="num">#{r.tokenId}</span>
                        {r.category ? ` \u00b7 ${r.category}` : ""}
                        {" \u00b7 "}
                        {r.evidenceVerified ? (
                          <span>evidence verified</span>
                        ) : (
                          <span style={{ color: "var(--fail)" }}>evidence unverified</span>
                        )}
                      </div>
                    </div>

                    <div className="xs">
                      <span className="pulse-dot" data-status={tone} /> {r.outcome}
                    </div>

                    <div className="num xs t-3" style={{ textAlign: "right" }}>
                      {humanMs(r.agentMs)}
                      {r.agentCost != null && (
                        <div className="t-4">{toTokens(r.agentCost)?.toFixed(4)} tok</div>
                      )}
                    </div>

                    <div className="num xs t-3" style={{ textAlign: "right" }}>
                      {humanMs(r.manualMs)}
                      {r.manualCost != null && (
                        <div className="t-4">{toTokens(r.manualCost)?.toFixed(4)} tok</div>
                      )}
                    </div>

                    <div
                      className="num xs"
                      style={{
                        textAlign: "right",
                        color:
                          c.timeSavedMs == null
                            ? undefined
                            : c.fasterAndUsable
                              ? "var(--pass)"
                              : "var(--fail)",
                      }}
                    >
                      {c.timeSavedMs == null
                        ? "\u2014"
                        : `${c.timeSavedMs >= 0 ? "" : "\u2212"}${humanMs(Math.abs(c.timeSavedMs))}`}
                      {c.timeSavedMs != null && c.timeSavedMs > 0 && !c.fasterAndUsable && (
                        <div className="t-4">but not usable</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="shell">
          <div className="headline-pair">
            <h2>02 &middot; What each run produced, and how the baseline was set</h2>
            <p className="prose sm">
              Outputs are shown because a duration says nothing about whether the answer
              was any good. The baseline note records how the job was done without an
              agent, so a reader can dispute the comparison rather than take it on trust.
            </p>
          </div>

          {a.perRun.map((c) => (
            <div className="surface-card mt-m" key={`detail-${c.run.tokenId}-${c.run.evidenceRef}`}>
              <div className="xs t-4">
                <span className="num">{c.run.createdAt.slice(0, 10)}</span>
                {" \u00b7 "}
                {c.run.evidenceKind}
                {" \u00b7 "}
                <span className="num">{c.run.evidenceRef.slice(0, 24)}</span>
                {" \u00b7 attested by "}
                <span className="num">{c.run.attester.slice(0, 12)}</span>
              </div>
              <h3 className="mt-s">{c.run.task}</h3>

              <p className="prose sm" style={{ marginBottom: "0.4rem" }}>
                <strong>Agent returned:</strong>{" "}
                {c.run.result ? c.run.result : <span className="t-4">nothing recorded</span>}
              </p>
              <p className="prose sm" style={{ margin: 0 }}>
                <strong>Manual arm:</strong>{" "}
                {c.run.manualNote ? c.run.manualNote : <span className="t-4">how it was done was not recorded</span>}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="band band-last">
        <div className="shell">
          <div className="headline-pair">
            <h2>03 &middot; What this comparison cannot tell you</h2>
            <p className="prose sm">
              Stated here rather than left for a reader to discover, on the same principle
              as the prober&apos;s single-region defect: a measurement whose limits are
              visible is evidence, and one whose limits are hidden is marketing.
            </p>
          </div>
          <ul className="prose sm" style={{ paddingLeft: "1.1rem" }}>
            <li>
              <strong>The manual arm is our manual arm.</strong> Somebody who does this
              job daily would be faster than we were, and somebody who has never done it
              would be slower. The baseline note says how we did it so you can judge.
            </li>
            <li>
              <strong>Output quality is not scored.</strong> There is no rubric that turns
              an answer into a number without smuggling in an opinion. The outputs are
              printed instead, and you decide.
            </li>
            <li>
              <strong>One run is one day.</strong> An agent that answered in two seconds
              today may be cold tomorrow, and the liveness ledger exists because that
              happens constantly.
            </li>
            <li>
              <strong>Cost excludes gas.</strong> The figures cover what the task charged,
              not the transaction fees around it.
            </li>
            <li>
              <strong>We ran these tasks.</strong> That makes us an interested party. It
              is why failures stay in the totals, why the successful-only figure is shown
              beside rather than instead, and why every run names its evidence.
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
