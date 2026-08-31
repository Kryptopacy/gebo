/**
 * Generate docs/ADVANTAGE_REPORT.md - the submission artifact TermiX requires.
 *
 * TermiX eligibility: "Submissions must include the required Agent Advantage
 * Report." Whether the intake form takes a link or an attachment, the artifact
 * must exist and must not be hand-written: a document whose entire claim is
 * "measured, not asserted" cannot contain hand-copied figures, which is the
 * same fault that made docs/MEASUREMENTS.md stale until it was generated.
 *
 * So this reads the SAME ledger and runs the SAME computation as the live
 * /compare page (taskRuns + computeAdvantage), and renders markdown from it.
 * One source of truth; the doc is a frozen snapshot taken at generation time,
 * the page is the current view.
 *
 * A failed read never writes a file. An empty ledger never writes a file.
 * Both exit non-zero with the reason - the "0 probes across 0 endpoints"
 * class of bug is invariant 9, and a submission document is the worst
 * possible place to rediscover it.
 *
 * Run: npm run report:advantage
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { taskRuns } from "../src/lib/attestations";
import { computeAdvantage, reportGaps, toTokens, humanMs } from "../src/lib/advantage";

const OUT = "docs/ADVANTAGE_REPORT.md";

/** Table cells must not contain pipes; anything user-visible gets sanitised. */
const cell = (s: string) => s.replace(/\|/g, "/");

/** Render free text (agent output, manual notes) as blockquote lines. */
function quote(text: string | null): string {
  if (!text || !text.trim()) return "> (nothing recorded)";
  return text
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
}

const tok = (v: bigint | null) => {
  const t = toTokens(v);
  return t == null ? "—" : t.toFixed(4);
};

const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(1)}%`);

const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

const { runs, unavailable, reason } = await taskRuns(56, 100);

if (unavailable) {
  console.error(`The task-run ledger could not be read: ${reason ?? "no reason reported"}.`);
  console.error("Nothing written - a report generated from a failed read would be the");
  console.error("'0 probes across 0 endpoints' fault, in the submission itself.");
  process.exit(1);
}

if (runs.length === 0) {
  console.error("The ledger holds no both-arms task runs. Nothing to report.");
  console.error("Populate it first: npx tsx scripts/run-advantage.ts --record");
  process.exit(1);
}

const a = computeAdvantage(runs);
const gaps = reportGaps(a);

// ── aggregates, mirroring /compare's conditionals exactly ────────────────────
const usable = a.succeeded;
const timeLine =
  usable === 0
    ? `**Time saved: none.** No run returned a usable answer, so no time was saved. The agents took ${humanMs(a.agentTotalMs)} against ${humanMs(a.manualTotalMs)} for the manual path, but they spent it failing - a fast error is not a fast answer.`
    : `**Time saved: ${a.netTimeSavedMs >= 0 ? "" : "−"}${humanMs(Math.abs(a.netTimeSavedMs))} (${pct(a.timeSavedPct)})** across ${a.timedBoth} run${a.timedBoth === 1 ? "" : "s"} timed on both arms — ${humanMs(a.agentTotalMs)} with an agent against ${humanMs(a.manualTotalMs)} without, failures included at full weight, and ${usable} of ${a.runs} returned the answer that was asked for.`;

const costLine =
  a.pricedBoth === 0
    ? `**Cost: —.** No run recorded a cost on both arms.`
    : a.netCostSaved === 0n
      ? `**Cost: 0 ${a.costToken ?? ""}`.trim() +
        `** across ${a.pricedBoth} priced run${a.pricedBoth === 1 ? "" : "s"} — nothing was charged on either arm. Both arms read public chain state; the marginal cash cost of a task is zero on each side.`
      : `**Cost: ${tok(a.agentTotalCost)} ${a.costToken ?? ""}`.trim() +
        `** across ${a.pricedBoth} priced run${a.pricedBoth === 1 ? "" : "s"}, against ${tok(a.manualTotalCost)} for the manual arm — the agent path was ${a.netCostSaved >= 0n ? "cheaper" : "dearer"} by ${tok(a.netCostSaved < 0n ? -a.netCostSaved : a.netCostSaved)}.`;

const gapBlock =
  gaps.length === 0
    ? `All clauses met as of generation: ${a.runs} runs (>= 3), high-stakes category covered (${a.categories.join(", ")}), every run timed on both arms (${a.timedBoth}/${a.runs}), outputs attached, ${a.verifiedRuns} run${a.verifiedRuns === 1 ? "" : "s"} with verified evidence.`
    : `**This ledger does not yet satisfy every clause.** Published anyway, because stating what is missing beats hiding it:\n${gaps.map((g) => `- ${g}`).join("\n")}`;

// ── per-run table ────────────────────────────────────────────────────────────
const tableRows = a.perRun
  .map((c) => {
    const r = c.run;
    const saved =
      c.timeSavedMs == null
        ? "—"
        : `${c.timeSavedMs >= 0 ? "" : "−"}${humanMs(Math.abs(c.timeSavedMs))}` +
          (c.timeSavedMs > 0 && !c.fasterAndUsable ? " (not usable)" : "");
    return [
      cell(r.createdAt.slice(0, 10)),
      cell(r.task),
      cell(`${r.agentName ?? `Agent ${r.tokenId}`} #${r.tokenId}`),
      cell(r.outcome),
      `${humanMs(r.agentMs)}${r.agentCost != null ? ` · ${tok(r.agentCost)}${r.costToken ? ` ${r.costToken}` : ""}` : ""}`,
      `${humanMs(r.manualMs)}${r.manualCost != null ? ` · ${tok(r.manualCost)}${r.costToken ? ` ${r.costToken}` : ""}` : ""}`,
      saved,
    ].join(" | ");
  })
  .map((row) => `| ${row} |`)
  .join("\n");

// ── per-run detail: outputs attached, baseline stated ────────────────────────
const runDetails = a.perRun
  .map((c) => {
    const r = c.run;
    return `### ${r.task} — ${r.agentName ?? `Agent ${r.tokenId}`} (#${r.tokenId})

- Date: ${r.createdAt.slice(0, 10)} · Category: ${r.category ?? "—"} · Outcome: **${r.outcome}**
- Evidence: ${r.evidenceKind} \`${r.evidenceRef.slice(0, 24)}\` · ${r.evidenceVerified ? "verified" : "UNVERIFIED"} · attested by \`${r.attester.slice(0, 12)}\`

**Agent returned:**

${quote(r.result)}

**Manual arm (same job, no agent):**

${quote(r.manualNote)}

**Timing:** agent ${humanMs(r.agentMs)} · by hand ${humanMs(r.manualMs)} · saved ${
      c.timeSavedMs == null ? "—" : `${c.timeSavedMs >= 0 ? "" : "−"}${humanMs(Math.abs(c.timeSavedMs))}`
    }${c.timeSavedMs != null && c.timeSavedMs > 0 && !c.fasterAndUsable ? " — but the reply was not usable, so the job still had to be done" : ""}`;
  })
  .join("\n\n---\n\n");

const md = `# Agent Advantage Report — GEBO

> **Generated file.** Regenerate with \`npm run report:advantage\`; do not edit by hand.
> A hand-maintained version of this document is exactly the fault this project
> exists to correct. Source of truth: the same task-run ledger that serves
> <https://gebo-bsc.vercel.app/compare>. Generated ${generatedAt}. This file is a
> snapshot taken for submission; the live page is the current view.

## What this report is

TermiX asks one question: does hiring an agent on your marketplace beat doing
the job yourself, and can you prove it? Each task below was run **both ways** —
once by an agent, once without one — with both arms timed and costed. The
manual arm runs the same computation an agent would (reads and arithmetic
only), so it understates rather than overstates agent advantage, and its
output is the ground truth the agent's reply is graded against: a reply that
does not carry the number the chain computes is graded PARTIAL or FAILED, not
generously.

Failures stay in the totals at full weight. Canned-sounding replies are
recorded as PARTIAL and honest declines as FAILED. A negative result is
published as one.

## The tasks

| Task | TermiX weighting tier | What was asked |
| --- | --- | --- |
| Venus health factor | security | The lending health factor of a live position, and whether it is at risk of liquidation — checkable to the cent against Venus's own getAccountLiquidity |
| Best Venus supply APR | yield | Which major Venus market currently pays suppliers the highest APR — checkable against supplyRatePerBlock on every market |
| PancakeSwap V3 pool tick | trading-infrastructure | The exact state of the deepest WBNB/USDT pool — checkable against slot0, and the number a grid or rebalancing agent must know before placing anything |

TermiX weights trading, equities and security highest; all three tasks sit in
that tier. Note on labelling: the "tier" above is the task's domain, while the
per-run rows further down carry each agent's marketplace category (grid,
health, rebalancing, ...), which can differ — a rebalancing agent asked a
trading-infrastructure question is recorded under its own category.

## Requirement check (encoded, not eyeballed)

${gapBlock}

## Aggregates

- **Runs:** ${a.runs} — ${a.succeeded} succeeded, ${a.partial} partial, ${a.failed} failed${a.disputed > 0 ? `, ${a.disputed} disputed` : ""}. ${a.verifiedRuns} with verified evidence.
- ${timeLine}
- ${costLine}
- **Successful runs only:** ${a.successOnlyTimeSavedPct == null ? "—" : pct(a.successOnlyTimeSavedPct)} — shown for contrast with the figure above, never instead of it.
${a.smallSample ? `- **Small sample, disclosed:** ${a.runs} runs describe exactly these tasks, on the days they ran, against these agents. They do not support a claim about agents in general.` : ""}

## Every run, including the ones that went badly

| Date | Task | Agent | Outcome | With agent | By hand | Saved |
| --- | --- | --- | --- | --- | --- | --- |
${tableRows}

## What each run produced, and how the baseline was set

Outputs are attached because a duration says nothing about whether the answer
was any good. The manual note records how the job was done without an agent so
the baseline can be argued with, not taken on trust.

${runDetails}

## Cost treatment on the hires themselves

The runs above price each arm in tokens where metering exists; token figures
exclude gas. The on-chain hires these agents serve run through APEX
(ERC-8183) escrow at **zero budget, deliberately**: demonstrating that escrow
custodies funds would be demonstrating BNB Chain's property, not ours, and
this project routes through APEX precisely so it is never the trusted party —
the grader is never the solver. A zero-budget job traverses the identical
state machine (Open → Funded → Submitted → Completed); only the two
safeTransfer calls are skipped, and setBudget(jobId, 0) is still required
because fund() reverts without a budget. \`cost = 0\` in the job record is a
true figure, not a missing one. Gas for three such jobs measured about
0.00023 BNB. Work that cannot be checked on chain (research, prose) is
metered per call via x402 at 0.01 $U rather than pretending to escrow it.

## What this comparison cannot tell you

- **The manual arm is our manual arm.** Somebody who does this job daily would
  be faster than we were; somebody who has never done it would be slower. The
  baseline notes say how we did it so you can judge.
- **Output quality is not scored.** There is no rubric that turns an answer
  into a number without smuggling in an opinion. The outputs are printed, and
  you decide.
- **One run is one day.** An agent that answered in two seconds today may be
  cold tomorrow; the liveness ledger exists because that happens constantly.
- **Cost excludes gas.** The figures cover what the task charged, not the
  transaction fees around it.
- **We ran these tasks.** That makes us an interested party. It is why
  failures stay in the totals, why the successful-only figure sits beside
  rather than instead of the honest one, and why every run names its evidence.

## Reproduce

- Live, always current: <https://gebo-bsc.vercel.app/compare>
- Refresh the ledger: \`npx tsx scripts/run-advantage.ts --record\`
- Regenerate this file: \`npm run report:advantage\`
`;

writeFileSync(OUT, md, "utf8");

console.log(`Agent Advantage Report written to ${OUT}`);
console.log(`  runs=${a.runs} (succeeded ${a.succeeded}, partial ${a.partial}, failed ${a.failed})`);
console.log(`  timed both arms: ${a.timedBoth}/${a.runs}; priced both arms: ${a.pricedBoth}/${a.runs}`);
console.log(`  verified evidence: ${a.verifiedRuns}/${a.runs}`);
console.log(
  `  time: agent ${humanMs(a.agentTotalMs)} vs manual ${humanMs(a.manualTotalMs)}; cost: agent ${tok(a.agentTotalCost)} vs manual ${tok(a.manualTotalCost)}`,
);
if (gaps.length > 0) {
  console.log("  REQUIREMENT GAPS (the report says so too):");
  for (const g of gaps) console.log(`    - ${g}`);
} else {
  console.log("  all TermiX report clauses met");
}
process.exit(0);
