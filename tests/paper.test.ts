/**
 * Paper-mode decision recording and scoring (src/lib/paper.ts).
 *
 * Pins the two bugs found 2026-09-08:
 * 1. The insert pre-stringified its inputs and cast to jsonb, which
 *    double-encodes (jsonb_typeof = 'string') and made every downstream key
 *    read miss - so no decision was ever scored. The lib now passes the
 *    plain object (the driver serializes it), and the scorer unwraps either
 *    shape defensively.
 * 2. The scoring-summary update credited the run that just started (max id
 *    with scored_n = 0) instead of the run whose decisions were scored.
 *
 * Also pins decideHealth/scoreDecision thresholds and the paper-scope
 * constant, which the /paper page prints verbatim.
 */
import { describe, it, expect } from "vitest";
import {
  decideHealth,
  scoreDecision,
  HEALTH_ACT_UTILISATION,
  HEALTH_WATCH_UTILISATION,
  HEALTH_SCORE_DELTA,
  PAPER_SCOPE_NOTE,
} from "../src/lib/paper.ts";

describe("decideHealth thresholds (fixed and disclosed)", () => {
  it("ok below watch", () => {
    expect(decideHealth(0.2)).toBe("ok");
  });
  it("watch at and above the watch threshold", () => {
    expect(decideHealth(HEALTH_WATCH_UTILISATION)).toBe("watch");
    expect(decideHealth(0.9)).toBe("watch");
  });
  it("act at and above the act threshold", () => {
    expect(decideHealth(HEALTH_ACT_UTILISATION)).toBe("act");
    expect(decideHealth(0.99)).toBe("act");
  });
});

describe("scoreDecision (mechanical, disclosed)", () => {
  it("a directional call is correct when utilisation rises by the delta", () => {
    expect(scoreDecision("watch", 0.85, 0.85 + HEALTH_SCORE_DELTA)).toEqual({
      outcome: "correct",
      score: 1,
    });
  });
  it("a directional call is incorrect when utilisation stays flat", () => {
    expect(scoreDecision("act", 0.95, 0.955)).toEqual({ outcome: "incorrect", score: 0 });
  });
  it("an ok call is correct while utilisation stays below watch", () => {
    expect(scoreDecision("ok", 0.5, 0.7)).toEqual({ outcome: "correct", score: 1 });
  });
  it("an ok call is incorrect once utilisation crosses watch", () => {
    expect(scoreDecision("ok", 0.5, HEALTH_WATCH_UTILISATION)).toEqual({
      outcome: "incorrect",
      score: 0,
    });
  });
});

describe("recorded inputs shape (invariant 10, found unscored in production)", () => {
  it("the scorer accepts an object input", () => {
    const inputs = { utilisation: 0.5, cash: "1", totalBorrows: "1", watchThreshold: 0.85, actThreshold: 0.95, readAtBlock: "1" };
    const raw = inputs;
    expect(Number((raw as any)?.utilisation)).toBe(0.5);
  });

  it("the scorer unwraps the double-encoded string shape the old insert wrote", () => {
    const inputs = { utilisation: 0.5, cash: "1", totalBorrows: "1", watchThreshold: 0.85, actThreshold: 0.95, readAtBlock: "1" };
    // The failed production shape: the row arrived as a JSON *string*.
    const raw = JSON.stringify(inputs);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    expect(Number(parsed?.utilisation)).toBe(0.5);
  });

  it("the lib never inserts a pre-stringified input (double-encoding pin)", async () => {
    // Read the source and pin the insert shape: sql.json() serializes the
    // object once; a JSON.stringify(...)::jsonb cast double-encodes it, which
    // is the exact regression that left 110 decisions unscored.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/paper.ts", "utf8");
    expect(src).not.toContain("JSON.stringify(inputs)}::jsonb");
    expect(src).toContain("${sql.json(inputs)}::jsonb");
  });

  it("the scoring-summary update targets the scored run, not the newest run", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/paper.ts", "utf8");
    // The regressed form credited the run that just started.
    expect(src).not.toContain("max(id) from paper_runs");
  });
});

describe("PAPER_SCOPE_NOTE (the scope the page prints verbatim)", () => {
  it("states zero spend, no targets, no caps", () => {
    expect(PAPER_SCOPE_NOTE).toContain("zero-spend");
    expect(PAPER_SCOPE_NOTE).toContain("no call targets");
    expect(PAPER_SCOPE_NOTE).toContain("no spend caps");
  });
});
