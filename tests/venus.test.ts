import { describe, it, expect } from "vitest";
import { verdictFor, summarise, type HealthReport } from "../src/lib/venus.ts";

/**
 * Venus health factor.
 *
 * The seeded reference agent's output has to be checkable, which is the whole reason
 * this question was chosen over something like "is this a good trade". These tests
 * pin the classification thresholds and the refusal to render a ratio that has no
 * denominator.
 */

function report(over: Partial<HealthReport> = {}): HealthReport {
  return {
    account: "0x1111111111111111111111111111111111111111",
    blockNumber: 117_700_000n,
    positions: [
      {
        vToken: "0x2222222222222222222222222222222222222222",
        symbol: "vUSDT",
        supplied: 1000,
        borrowed: 400,
        suppliedUsd: 1000,
        borrowedUsd: 400,
        collateralFactor: 0.8,
      },
    ],
    borrowingPowerUsd: 800,
    totalBorrowedUsd: 400,
    totalSuppliedUsd: 1000,
    healthFactor: 2,
    liquidityUsd: 400,
    shortfallUsd: 0,
    closeFactor: 0.5,
    liquidationIncentive: 1.1,
    verdict: "safe",
    ...over,
  };
}

describe("verdictFor", () => {
  it("classifies against published thresholds", () => {
    expect(verdictFor(2.0, true, 400)).toBe("safe");
    expect(verdictFor(1.5, true, 400)).toBe("safe");
    expect(verdictFor(1.49, true, 400)).toBe("watch");
    expect(verdictFor(1.1, true, 400)).toBe("watch");
    expect(verdictFor(1.09, true, 400)).toBe("at risk");
    expect(verdictFor(1.0, true, 400)).toBe("liquidatable");
    expect(verdictFor(0.8, true, 400)).toBe("liquidatable");
  });

  it("distinguishes no collateral, no debt, and dust debt", () => {
    // Both are safe, but they are not the same fact, and a monitoring agent that
    // conflates them would report "safe" for a wallet it has never seen.
    expect(verdictFor(null, false, 0)).toBe("no collateral enabled");
    expect(verdictFor(null, true, 0)).toBe("no debt");
    // Dust is its own verdict. Folding $0.000007 into "no debt" would assert
    // something false and look like a detection failure at the same time.
    expect(verdictFor(null, true, 0.000007)).toBe("dust debt");
    expect(verdictFor(null, true, 0.009)).toBe("dust debt");
    expect(verdictFor(2, true, 0.01)).toBe("safe");
  });
});

describe("summarise", () => {
  it("carries the denominator with the ratio", () => {
    // Design law L2: a health factor without the collateral and debt behind it is a
    // bare number. The deliverable is this string, so it has to be self-contained.
    const s = summarise(report());
    expect(s).toMatch(/Health factor 2\.0000/);
    expect(s).toMatch(/\$800\.00 of borrowing power/);
    expect(s).toMatch(/\$400\.00 borrowed/);
    expect(s).toMatch(/block 117700000/);
    expect(s).toMatch(/Liquidatable at or below 1\.0/);
  });

  it("states the liquidation terms, since they decide the loss", () => {
    const s = summarise(report());
    expect(s).toMatch(/close 50% of the debt/);
    expect(s).toMatch(/10% incentive/);
  });

  it("refuses to invent a ratio when there is no debt", () => {
    // Dividing by zero borrows is undefined, not infinite. Rendering Infinity as a
    // health score would be absurd, and rendering 0 would be a lie.
    const s = summarise(report({ healthFactor: null, totalBorrowedUsd: 0, verdict: "no debt" }));
    expect(s).toMatch(/no health factor is reported/);
    expect(s).not.toMatch(/Infinity|NaN/);
  });

  it("distinguishes un-entered supply from having nothing", () => {
    const s = summarise(report({ positions: [], verdict: "no collateral enabled", healthFactor: null }));
    expect(s).toMatch(/No Venus market is enabled as collateral/);
    expect(s).toMatch(/block 117700000/);
  });

  it("refuses a ratio against dust debt, which produced 65,029,489 on a live position", () => {
    // An account with $465.89 of borrowing power and a fraction of a cent of debt
    // reported a health factor of 65 million, printed as though measured. A ratio
    // against a near-zero denominator is noise wearing a number's clothes.
    const s = summarise(report({ healthFactor: null, totalBorrowedUsd: 0.000007, verdict: "dust debt" }));
    // The sub-cent figure is printed, so it reads as measured and judged rather
    // than as debt we failed to notice.
    expect(s).toMatch(/0\.00000700 borrowed/);
    expect(s).toMatch(/below the \$0\.01 floor/);
    expect(s).not.toMatch(/65029489|NaN|Infinity/);
  });

  it("never emits NaN or Infinity for any verdict", () => {
    for (const hf of [null, 0, 0.5, 1, 1.05, 1.3, 99]) {
      const s = summarise(report({ healthFactor: hf, totalBorrowedUsd: hf == null ? 0 : 400 }));
      expect(s).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
