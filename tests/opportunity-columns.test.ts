/**
 * Pins the opportunity-column formatting corrections:
 *
 * 1. A failed liquidation-incentive read (null, or 0 coerced by an older
 *    indexer) must render "unmeasured", never the arithmetic on zero
 *    ("-100.0%") - invariant 9: a failed measurement is not a number.
 * 2. Large 18-decimal mantissas render compactly ("178.4M"), not as
 *    scientific notation with a trailing "e18".
 */
import { describe, expect, it } from "vitest";
import { OPPORTUNITY_COLUMNS } from "../src/lib/data";

const col = (cat: "health" | "rebalancing" | "grid", key: string) => {
  const c = OPPORTUNITY_COLUMNS[cat]!.find((x) => x.key === key);
  if (!c) throw new Error(`no column ${key} for ${cat}`);
  return c;
};

describe("health opportunity columns", () => {
  it("renders a failed liquidation-incentive read as unmeasured", () => {
    const fmt = col("health", "liquidationIncentive").fmt;
    expect(fmt(null, {})).toBe("unmeasured");
    expect(fmt(0, {})).toBe("unmeasured");
  });

  it("renders a real incentive as a premium over collateral", () => {
    expect(col("health", "liquidationIncentive").fmt(1.1, {})).toBe("+10.0%");
  });

  it("renders a failed close-factor read as unmeasured", () => {
    expect(col("health", "closeFactor").fmt(null, {})).toBe("unmeasured");
    expect(col("health", "closeFactor").fmt(0.5, {})).toBe("50%");
  });

  it("compacts 18-decimal mantissas without scientific notation", () => {
    const fmt = col("health", "totalBorrows").fmt;
    expect(fmt("178448389541009952872017", {})).toBe("178.4k");
    expect(fmt("105200000000000000000000", {})).toBe("105.2k");
    expect(fmt("3261718113042395131903335", {})).toBe("3.3M");
    expect(fmt("0", {})).toBe("—");
    expect(fmt(null, {})).toBe("—");
  });
});

describe("rebalancing opportunity columns", () => {
  it("renders in-range depth in USD", () => {
    const fmt = col("rebalancing", "depthUsd").fmt;
    expect(fmt(2_500_000, {})).toBe("$2.5M");
    expect(fmt(45_000, {})).toBe("$45k");
    expect(fmt(999, {})).toBe("$999");
    expect(fmt(null, {})).toBe("—");
  });
});
