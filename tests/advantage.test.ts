import { describe, it, expect } from "vitest";
import {
  computeAdvantage, compareRun, reportGaps, toTokens, humanMs, type TaskRun,
} from "../src/lib/advantage.ts";

/**
 * Agent Advantage.
 *
 * These tests exist mainly to stop the measurement flattering its subject. The
 * easiest way to fake an advantage is to average only the runs that worked, so the
 * aggregate is pinned to include failures and the success-only figure is pinned to
 * be reported separately rather than instead.
 */

function run(over: Partial<TaskRun> = {}): TaskRun {
  return {
    tokenId: "1",
    agentName: "Agent",
    category: "yield",
    task: "Find the best stablecoin APR on BNB Chain",
    result: "Venus USDT 6.1%",
    outcome: "succeeded",
    agentMs: 2_000,
    agentCost: 250_000_000_000_000_000n, // 0.25 at 18 decimals
    costToken: "0xUSD",
    manualMs: 300_000,
    manualCost: 0n,
    manualNote: "Read the contract by hand",
    evidenceKind: "gebo_task",
    evidenceRef: "task-1",
    evidenceVerified: true,
    attester: "0xGEBO",
    createdAt: "2026-08-23T00:00:00.000Z",
    ...over,
  };
}

describe("compareRun", () => {
  it("reports time and cost saved with the manual arm as the baseline", () => {
    const c = compareRun(run());
    expect(c.timeSavedMs).toBe(298_000);
    expect(c.costSaved).toBe(-250_000_000_000_000_000n); // the agent cost money
    expect(c.fasterAndUsable).toBe(true);
  });

  it("refuses to call a failed run a win, however fast it was", () => {
    // Being wrong quickly is not an advantage. A clock alone would score this.
    const c = compareRun(run({ outcome: "failed", agentMs: 5, result: null }));
    expect(c.timeSavedMs).toBe(299_995);
    expect(c.fasterAndUsable).toBe(false);
  });

  it("returns null rather than guessing when an arm is untimed", () => {
    expect(compareRun(run({ manualMs: null })).timeSavedMs).toBeNull();
    expect(compareRun(run({ agentCost: null })).costSaved).toBeNull();
  });
});

describe("computeAdvantage", () => {
  it("includes failures in the aggregate, which is the whole integrity of it", () => {
    // Two fast successes and one slow failure. Dropping the failure would report
    // a large advantage; including it is the honest number.
    const runs = [
      run({ agentMs: 1_000, manualMs: 100_000 }),
      run({ agentMs: 1_000, manualMs: 100_000 }),
      run({ outcome: "failed", agentMs: 60_000, manualMs: 100_000, result: null }),
    ];
    const a = computeAdvantage(runs);

    expect(a.runs).toBe(3);
    expect(a.failed).toBe(1);
    expect(a.agentTotalMs).toBe(62_000);
    expect(a.manualTotalMs).toBe(300_000);
    expect(a.netTimeSavedMs).toBe(238_000);

    // The success-only figure is larger. Both must be available so neither can be
    // quoted as though it were the other.
    expect(a.successOnlyNetTimeSavedMs).toBe(198_000);
    expect(a.successOnlyNetTimeSavedMs).toBeLessThan(a.netTimeSavedMs);
    expect(a.successOnlyTimeSavedPct!).toBeGreaterThan(a.timeSavedPct!);
  });

  it("publishes a negative result when the manual path won", () => {
    // A comparison that cannot embarrass its subject is marketing.
    const a = computeAdvantage([run({ agentMs: 90_000, manualMs: 30_000 })]);
    expect(a.netTimeSavedMs).toBe(-60_000);
    expect(a.timeSavedPct).toBeLessThan(0);
  });

  it("never divides by a zero baseline", () => {
    // An instantaneous manual arm would otherwise emit Infinity onto a page.
    const a = computeAdvantage([run({ manualMs: 0, agentMs: 500 })]);
    expect(a.timeSavedPct).toBeNull();
  });

  it("counts only runs with both arms timed toward the time denominator", () => {
    const a = computeAdvantage([run(), run({ manualMs: null }), run({ agentMs: null })]);
    expect(a.runs).toBe(3);
    expect(a.timedBoth).toBe(1);
  });

  it("sums costs as bigint base units, never as floats", () => {
    // 18 decimals. Float addition here loses precision silently.
    const a = computeAdvantage([
      run({ agentCost: 250_000_000_000_000_000n, manualCost: 0n }),
      run({ agentCost: 100_000_000_000_000_000n, manualCost: 0n }),
    ]);
    expect(a.agentTotalCost).toBe(350_000_000_000_000_000n);
    expect(a.netCostSaved).toBe(-350_000_000_000_000_000n);
  });

  it("flags a small sample rather than leaving it to the copy", () => {
    expect(computeAdvantage([run(), run(), run()]).smallSample).toBe(true);
    expect(computeAdvantage(Array.from({ length: 10 }, () => run())).smallSample).toBe(false);
  });

  it("detects high-stakes coverage from the category, not from wording", () => {
    expect(computeAdvantage([run({ category: "research" })]).highStakesCovered).toBe(false);
    expect(computeAdvantage([run({ category: "trading" })]).highStakesCovered).toBe(true);
    // A health-factor agent moves a real lending position, so it qualifies.
    expect(computeAdvantage([run({ category: "health" })]).highStakesCovered).toBe(true);
  });

  it("handles an empty set without inventing figures", () => {
    const a = computeAdvantage([]);
    expect(a.runs).toBe(0);
    expect(a.timeSavedPct).toBeNull();
    expect(a.successOnlyNetTimeSavedMs).toBeNull();
    expect(a.highStakesCovered).toBe(false);
  });
});

describe("reportGaps", () => {
  it("names every unmet clause of the submission requirement", () => {
    const gaps = reportGaps(computeAdvantage([run({ category: "research", result: null, evidenceVerified: false })]));
    expect(gaps.join(" | ")).toMatch(/only 1 task run/);
    expect(gaps.join(" | ")).toMatch(/high-stakes/);
    expect(gaps.join(" | ")).toMatch(/attached output/);
    expect(gaps.join(" | ")).toMatch(/verified evidence/);
  });

  it("is silent when the requirement is satisfied", () => {
    const runs = [run({ category: "trading" }), run(), run({ category: "health" })];
    expect(reportGaps(computeAdvantage(runs))).toHaveLength(0);
  });
});

describe("formatting", () => {
  it("converts base units at 18 decimals and keeps the sign", () => {
    expect(toTokens(250_000_000_000_000_000n)).toBeCloseTo(0.25, 10);
    expect(toTokens(-250_000_000_000_000_000n)).toBeCloseTo(-0.25, 10);
    expect(toTokens(null)).toBeNull();
  });

  it("renders durations at a sensible scale", () => {
    expect(humanMs(450)).toBe("450 ms");
    expect(humanMs(2_400)).toBe("2.4s");
    expect(humanMs(null)).toBe("\u2014");
    expect(humanMs(125_000)).toMatch(/^2m/);
  });
});
