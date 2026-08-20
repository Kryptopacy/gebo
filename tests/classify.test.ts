import { describe, it, expect } from "vitest";
import { classifyCapability, isJudged, JUDGED } from "../src/lib/classify.ts";

/**
 * Classification regressions, each anchored to a real bug found in the corpus.
 *
 * The classifier was tightened four times during development and every
 * correction reduced the count. These tests exist so it cannot loosen again by
 * accident, because inflating a judged category corrupts exactly the hire
 * decision this product is meant to inform.
 */
describe("classifyCapability - judged categories", () => {
  it("classifies a rebalancer from its own skills", () => {
    const c = classifyCapability({
      name: "RangeKeeper",
      description: "Moves your liquidity back into range so it keeps earning",
      skills: ["rebalancing", "liquidity", "pancakeswap"],
    });
    expect(c.category).toBe("rebalancing");
    expect(c.judged).toBe(true);
    expect(c.source).toBe("skills");
  });

  it("reads hyphenated self-tags, which are the most precise evidence available", () => {
    // HealthGuard was mislabelled yield off a bare "venus" hit, because
    // "health-factor-monitoring" never matched the phrase "health factor".
    const c = classifyCapability({
      name: "HealthGuard",
      description: "Watches your loan and repays before it can be liquidated",
      skills: ["health-factor-monitoring", "protect", "venus", "defi", "bsc"],
    });
    expect(c.category).toBe("health");
  });

  it("prefers specific evidence over a protocol name", () => {
    // Venus serves both supplying (yield) and borrowing (health factor), so the
    // bare protocol name must not decide the category.
    const c = classifyCapability({
      name: "Guard",
      skills: ["venus", "avoid liquidation", "repay debt"],
    });
    expect(c.category).toBe("health");
  });

  it("classifies yield only on specific evidence", () => {
    expect(classifyCapability({ name: "YieldRouter", skills: ["yield-optimisation", "venus", "lista"] }).category).toBe("yield");
  });
});

describe("classifyCapability - refuses to inflate", () => {
  it("does not treat DCA as grid trading", () => {
    // This inflated grid from 33 to 93 agents. DCA buys at intervals; grid places
    // a ladder across a range. Different strategies.
    const c = classifyCapability({ name: "Agent", skills: ["dollar-cost", "buy the dip", "dca"] });
    expect(c.category).toBe("trading");
    expect(c.judged).toBe(false);
  });

  it("does not classify a judged category from a bare corroborating word", () => {
    // Bare "yield" inflated the yield category to 36 agents.
    const c = classifyCapability({ name: "Thing", skills: ["yield"] });
    expect(isJudged(c.category)).toBe(false);
  });

  it("does not match short words inside longer ones", () => {
    // Bare "lp" matched 192 agents through "help" and "alpha".
    const c = classifyCapability({ name: "Alpha Helper", description: "I can help you" });
    expect(c.category).not.toBe("rebalancing");
  });

  it("leaves an agent unclassified when there is no capability evidence", () => {
    for (const name of ["premium", "ala", "Professor", "aaaaaaaaaa", "game", ""]) {
      expect(classifyCapability({ name }).category).toBeNull();
    }
  });

  it("returns null rather than guessing on empty input", () => {
    const c = classifyCapability({});
    expect(c.category).toBeNull();
    expect(c.confidence).toBe(0);
    expect(c.matched).toEqual([]);
  });
});

describe("classifyCapability - evidence and precedence", () => {
  it("always records the evidence that produced the assignment", () => {
    const c = classifyCapability({ name: "Grid Trader", skills: ["grid-trading"] });
    expect(c.matched.length).toBeGreaterThan(0);
    expect(c.confidence).toBeGreaterThan(0);
  });

  it("prefers a judged category over an adjacent one when both match", () => {
    // An agent that grid-trades is also trading; the specific job wins.
    const c = classifyCapability({ name: "GridRunner", skills: ["grid trading", "swap", "trade"] });
    expect(c.category).toBe("grid");
  });

  it("weights skills above a name", () => {
    const c = classifyCapability({ name: "Yield Thing", skills: ["grid trading"] });
    expect(c.category).toBe("grid");
    expect(c.source).toBe("skills");
  });

  it("exposes exactly four judged categories", () => {
    expect(JUDGED).toHaveLength(4);
    expect([...JUDGED].sort()).toEqual(["grid", "health", "rebalancing", "yield"]);
  });
});
