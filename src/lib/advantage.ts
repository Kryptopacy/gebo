/**
 * Agent Advantage: did hiring the agent beat doing the job yourself?
 *
 * The third question a registry cannot answer. Liveness proves an agent responds
 * and authority proves what it may touch, but neither says whether the hire was
 * worth it. This computes that from recorded task runs, each of which carries both
 * arms of the comparison: what the agent took and cost, and what the same job took
 * and cost without one.
 *
 * FAILURES ARE NEVER DROPPED FROM THE AGGREGATE.
 *
 * This is the whole integrity of the measurement. An agent that ran for forty
 * seconds, charged for it, and returned nothing usable has a real cost and a real
 * duration. Averaging only the successes is the standard way to manufacture an
 * advantage, and it is why vendor benchmarks are worthless. So the aggregate spans
 * every run, and the successful subset is reported separately and labelled as such,
 * letting a reader see both without either being hidden.
 *
 * A NEGATIVE RESULT IS A RESULT. If the manual path is faster or cheaper, that is
 * what gets published. A comparison that can only flatter the thing being sold is
 * marketing, and this project's argument is that measurement should be able to
 * embarrass its subject.
 *
 * SMALL n IS DISCLOSED STRUCTURALLY, not left to whoever writes the copy. Three
 * runs cannot support a percentage claim about agents in general, so the result
 * carries the observation count and a flag the UI must render. Design law L2 says a
 * metric travels with its denominator; here the denominator is the point.
 *
 * COSTS ARE BIGINT BASE UNITS. BNB stablecoins carry 18 decimals, not 6, and a
 * slip is a 10^12 error. Conversion happens once, at the edge, for display only.
 */

export type RunOutcome = "succeeded" | "partial" | "failed" | "disputed";

/** One task, run both ways. */
export type TaskRun = {
  tokenId: string;
  agentName: string | null;
  /** Judged or adjacent category, for the high-stakes coverage check. */
  category: string | null;
  task: string;
  /** What the agent returned. Held so a reader can judge quality themselves. */
  result: string | null;
  outcome: RunOutcome;

  /** The agent arm. */
  agentMs: number | null;
  agentCost: bigint | null;
  costToken: string | null;

  /** The manual arm: the same job done without an agent. */
  manualMs: number | null;
  manualCost: bigint | null;
  manualNote: string | null;

  /** Provenance, so the run is checkable rather than asserted. */
  evidenceKind: string;
  evidenceRef: string;
  evidenceVerified: boolean;
  attester: string;
  createdAt: string;
};

export type RunComparison = {
  run: TaskRun;
  /** Positive means the agent was faster. Null when either arm is untimed. */
  timeSavedMs: number | null;
  /** Positive means the agent was cheaper. Null when either arm is unpriced. */
  costSaved: bigint | null;
  /**
   * Did this run beat the manual path on time?
   *
   * Requires a SUCCEEDED outcome, not merely a non-failure. A partial result means the
   * agent replied without producing the answer that was asked for - a health-factor
   * question returning prose with no ratio in it - and you still have to do the work
   * yourself afterwards. Counting that as a saving would credit the agent for the time
   * it took to not answer, which is the same error as crediting a fast error.
   */
  fasterAndUsable: boolean;
};

export type Advantage = {
  /** Every run considered, failures included. */
  runs: number;
  succeeded: number;
  partial: number;
  failed: number;
  disputed: number;

  /** Runs with both arms timed, which is the denominator for the time figures. */
  timedBoth: number;
  /** Runs with both arms priced. */
  pricedBoth: number;

  /** Totals across ALL runs with both arms timed, failures included. */
  agentTotalMs: number;
  manualTotalMs: number;
  /** Positive means agents were faster overall. */
  netTimeSavedMs: number;
  /** Null rather than Infinity when the manual arm took no measurable time. */
  timeSavedPct: number | null;

  agentTotalCost: bigint;
  manualTotalCost: bigint;
  netCostSaved: bigint;
  costToken: string | null;

  /** The same time figures over successful runs only, for contrast. */
  successOnlyNetTimeSavedMs: number | null;
  successOnlyTimeSavedPct: number | null;

  /** Categories represented, and whether the high-stakes requirement is met. */
  categories: string[];
  highStakesCovered: boolean;

  /** True while the sample is too small to generalise from. */
  smallSample: boolean;
  /** Runs whose evidence was confirmed on chain or by us running the task. */
  verifiedRuns: number;

  perRun: RunComparison[];
};

/**
 * Categories the rubric treats as high stakes, where a track record matters most.
 *
 * `security` and `stock` are named by the rubric alongside trading. `grid`,
 * `rebalancing`, `yield` and `health` all move real positions, so they qualify:
 * every one of them can lose money when wrong, which is the distinction being
 * drawn - not whether the word "trading" appears.
 */
const HIGH_STAKES = new Set([
  "trading", "stock", "equities", "security",
  "grid", "rebalancing", "yield", "health", "payments",
]);

/** Below this, an aggregate describes these runs and nothing wider. */
const SMALL_SAMPLE_BELOW = 10;

export function compareRun(run: TaskRun): RunComparison {
  const timeSavedMs =
    run.agentMs != null && run.manualMs != null ? run.manualMs - run.agentMs : null;
  const costSaved =
    run.agentCost != null && run.manualCost != null ? run.manualCost - run.agentCost : null;

  return {
    run,
    timeSavedMs,
    costSaved,
    // "Usable" is doing real work here: neither a fast error nor a fast non-answer
    // is a saving, because in both cases the job still has to be done afterwards.
    fasterAndUsable: timeSavedMs != null && timeSavedMs > 0 && run.outcome === "succeeded",
  };
}

export function computeAdvantage(runs: TaskRun[]): Advantage {
  const perRun = runs.map(compareRun);

  const timed = perRun.filter((c) => c.run.agentMs != null && c.run.manualMs != null);
  const priced = perRun.filter((c) => c.run.agentCost != null && c.run.manualCost != null);

  const agentTotalMs = timed.reduce((n, c) => n + (c.run.agentMs ?? 0), 0);
  const manualTotalMs = timed.reduce((n, c) => n + (c.run.manualMs ?? 0), 0);
  const netTimeSavedMs = manualTotalMs - agentTotalMs;

  const agentTotalCost = priced.reduce((n, c) => n + (c.run.agentCost ?? 0n), 0n);
  const manualTotalCost = priced.reduce((n, c) => n + (c.run.manualCost ?? 0n), 0n);

  const success = timed.filter((c) => c.run.outcome === "succeeded");
  const successAgentMs = success.reduce((n, c) => n + (c.run.agentMs ?? 0), 0);
  const successManualMs = success.reduce((n, c) => n + (c.run.manualMs ?? 0), 0);

  const categories = [...new Set(runs.map((r) => r.category).filter((c): c is string => !!c))].sort();

  return {
    runs: runs.length,
    succeeded: runs.filter((r) => r.outcome === "succeeded").length,
    partial: runs.filter((r) => r.outcome === "partial").length,
    failed: runs.filter((r) => r.outcome === "failed").length,
    disputed: runs.filter((r) => r.outcome === "disputed").length,

    timedBoth: timed.length,
    pricedBoth: priced.length,

    agentTotalMs,
    manualTotalMs,
    netTimeSavedMs,
    // Guard the denominator rather than emitting Infinity into a page.
    timeSavedPct: manualTotalMs > 0 ? (netTimeSavedMs / manualTotalMs) * 100 : null,

    agentTotalCost,
    manualTotalCost,
    netCostSaved: manualTotalCost - agentTotalCost,
    costToken: priced.find((c) => c.run.costToken)?.run.costToken ?? null,

    successOnlyNetTimeSavedMs: success.length ? successManualMs - successAgentMs : null,
    successOnlyTimeSavedPct:
      success.length && successManualMs > 0
        ? ((successManualMs - successAgentMs) / successManualMs) * 100
        : null,

    categories,
    highStakesCovered: categories.some((c) => HIGH_STAKES.has(c)),

    smallSample: runs.length < SMALL_SAMPLE_BELOW,
    verifiedRuns: runs.filter((r) => r.evidenceVerified).length,

    perRun,
  };
}

/**
 * Does this satisfy the Agent Advantage Report requirement?
 *
 * Encoded rather than eyeballed, because the requirement is specific and a
 * submission that misses one clause scores nothing for the whole criterion. Returns
 * the unmet conditions so a script can print exactly what is still missing.
 */
export function reportGaps(a: Advantage): string[] {
  const gaps: string[] = [];
  if (a.runs < 3) gaps.push(`only ${a.runs} task run(s) recorded; at least 3 are required`);
  if (!a.highStakesCovered) {
    gaps.push("no run in a high-stakes category (trading, stock or security)");
  }
  if (a.timedBoth < a.runs) {
    gaps.push(`${a.runs - a.timedBoth} run(s) missing a timing on one arm`);
  }
  if (!a.perRun.some((c) => c.run.result && c.run.result.trim().length > 0)) {
    gaps.push("no run has an attached output; the report requires actual outputs");
  }
  if (a.verifiedRuns === 0) {
    gaps.push("no run has verified evidence; every run would read as a claim");
  }
  return gaps;
}

/** Base units to whole tokens. 18 decimals on BSC, not 6. Display only. */
export function toTokens(v: bigint | null, decimals = 18): number | null {
  if (v == null) return null;
  const d = BigInt(10) ** BigInt(decimals);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / d;
  const frac = abs % d;
  const n = Number(whole) + Number(frac) / Number(d);
  return neg ? -n : n;
}

/** Human duration. "1.4s" reads better than "1400 ms" and rounds honestly. */
export function humanMs(ms: number | null): string {
  if (ms == null) return "\u2014";
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(ms)} ms`;
  if (abs < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((Math.abs(ms) % 60_000) / 1000)}s`;
}
