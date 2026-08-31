/**
 * Pins the opportunity-detail presentation layer (OPPORTUNITY_DETAIL_FIELDS):
 *
 * 1. V3 pool price orientation. The raw ratio from sqrtPriceX96 is token1 per
 *    token0 where token0 is the ADDRESS-SORTED token, not the payload's
 *    tokenA/tokenB order. Getting this backwards inverts the price.
 * 2. No fake "e18" scaling. The old detail view divided any 15+ digit integer
 *    by 1e18 - meaningless for sqrtPriceX96 (2^96 fixed point) and for V3
 *    liquidity (not a token amount).
 * 3. A zero depthUsd with live liquidity is "unpriced", not "$0" (invariant 9).
 * 4. Venus APR rows carry their rate basis and block assumption (design law L2).
 * 5. Every key the indexer payloads actually contain is consumed by the spec,
 *    so a known payload renders fully translated - nothing leaks to the raw
 *    group by accident.
 */
import { describe, expect, it } from "vitest";
import { OPPORTUNITY_DETAIL_FIELDS } from "../src/lib/data";

const field = (cat: "rebalancing" | "grid" | "yield" | "health", key: string) => {
  const f = OPPORTUNITY_DETAIL_FIELDS[cat]!.find((x) => x.key === key);
  if (!f) throw new Error(`no detail field ${key} for ${cat}`);
  return f;
};

// 2^93: raw price = (2^93 / 2^96)^2 = 1/64 token1 per token0.
const Q_93 = (2n ** 93n).toString();

describe("pool detail fields", () => {
  it("orients the derived price by the address-sorted token0/token1 order", () => {
    // WBNB (0xbb4c...) sorts after USDT (0x55d3...), so token0 is USDT and the
    // raw 1/64 is WBNB-per-USDT: 1 WBNB = 64 USDT.
    const cell = field("rebalancing", "sqrtPriceX96").render(Q_93, { tokenA: "WBNB", tokenB: "USDT" });
    expect(cell!.text).toBe("1 WBNB = 64.00 USDT");

    // Same pool declared the other way round: 1 USDT = 1/64 WBNB.
    const rev = field("grid", "sqrtPriceX96").render(Q_93, { tokenA: "USDT", tokenB: "WBNB" });
    expect(rev!.text).toBe("1 USDT = 0.01563 WBNB");
  });

  it("renders active liquidity as raw tick-space units, never e18-scaled", () => {
    const cell = field("rebalancing", "liquidity").render("1234567890123456789012", {});
    expect(cell!.text).toBe("1,234,567,890,123,456,789,012");
    expect(cell!.text).not.toContain("e18");
    expect(cell!.note).toContain("not a token amount");
  });

  it("renders zero depth with live liquidity as unpriced, not $0", () => {
    const cell = field("rebalancing", "depthUsd").render(0, { liquidity: "1000000" });
    expect(cell!.text).toBe("unpriced");
    expect(field("rebalancing", "depthUsd").render(2_500_000, {})!.text).toBe("$2.5M");
  });

  it("uses the payload's own depth basis as the note", () => {
    const cell = field("rebalancing", "depthUsd").render(45_000, {
      depthBasis: "2 * L * sqrt(P) priced in token1 - marginal in-range depth proxy, not TVL",
    });
    expect(cell!.note).toContain("not TVL");
  });
});

describe("venus detail fields", () => {
  const p = {
    rateBasis: "simple annualisation of per-block rate",
    blocksPerYearAssumed: 10_512_000,
    blocksPerYearCaveat: "Venus core assumes 3s blocks; BSC is faster, so this understates the true rate",
  };

  it("carries the rate basis and block assumption with both APRs", () => {
    const supply = field("yield", "supplyAprPct").render(2.31, p);
    expect(supply!.text).toBe("2.31%");
    expect(supply!.note).toContain("simple annualisation");
    expect(supply!.note).toContain("10,512,000");
    expect(supply!.note).toContain("3s blocks");

    const borrow = field("health", "borrowAprPct").render(5.02, p);
    expect(borrow!.note).toContain("understates the true rate");
  });

  it("renders a failed liquidation-incentive read as unmeasured with its reason", () => {
    const cell = field("health", "liquidationIncentive").render(null, {
      liquidationIncentiveNote: "unmeasured - the Comptroller's Diamond facets expose no incentive getter",
    });
    expect(cell!.text).toBe("unmeasured");
    expect(cell!.note).toContain("no incentive getter");
    expect(field("health", "liquidationIncentive").render(1.1, {})!.text).toBe("+10.0% above the debt repaid");
  });

  it("compacts 18-decimal borrows with the market symbol", () => {
    const cell = field("yield", "totalBorrows").render("178448389541009952872017", { symbol: "USDT" });
    expect(cell!.text).toBe("178.4k USDT");
  });
});

describe("spec coverage of real indexer payloads", () => {
  it("consumes every key the cron writes for PancakeSwap V3 pools", () => {
    const keys = [
      "pool", "tokenA", "tokenB", "feeTier", "feePct", "tickSpacing", "currentTick",
      "sqrtPriceX96", "liquidity", "depthUsd", "depthBasis", "stablePair", "unlocked",
      "observationCardinality", "masterChefV3", "readAtBlock",
    ];
    const specKeys = new Set(OPPORTUNITY_DETAIL_FIELDS.rebalancing!.map((f) => f.key));
    const missing = keys.filter((k) => !specKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("consumes every key the cron writes for Venus markets", () => {
    const keys = [
      "vToken", "symbol", "supplyAprPct", "borrowAprPct", "rateBasis",
      "blocksPerYearAssumed", "blocksPerYearCaveat", "utilisation", "totalBorrows",
      "cash", "collateralFactor", "closeFactor", "liquidationIncentive",
      "liquidationIncentiveNote", "isListed", "readAtBlock",
    ];
    for (const cat of ["yield", "health"] as const) {
      const specKeys = new Set(OPPORTUNITY_DETAIL_FIELDS[cat]!.map((f) => f.key));
      expect(keys.filter((k) => !specKeys.has(k))).toEqual([]);
    }
  });
});
