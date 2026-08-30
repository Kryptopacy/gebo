/**
 * Grid replay simulator: the trading record's arithmetic.
 *
 * These tests exist because a backtest is the easiest place in this codebase
 * to manufacture an advantage - a sign flip, a fee quietly dropped, a window
 * that starts at the bottom. Each test pins a property the record's honesty
 * depends on.
 */
import { describe, it, expect } from "vitest";
import {
  simulateGrid,
  gridLevels,
  poolDepthUsd,
  wbnbUsdFromPool,
  sortToken0Token1,
  type PricePoint,
} from "../src/lib/grid-record.ts";

const base = {
  lowerPrice: 0.97,
  upperPrice: 1.03,
  bandsPerSide: 8,
  capitalUsd: 1_000,
  feePctPerLeg: 0,
};

/** 17 levels for 8 bands per side, spanning exactly [lower, upper]. */
describe("gridLevels", () => {
  it("spans the bounds with bands*2+1 levels", () => {
    const ls = gridLevels(base, 1);
    expect(ls).toHaveLength(17);
    expect(ls[0]).toBeCloseTo(0.97, 10);
    expect(ls[16]).toBeCloseTo(1.03, 10);
  });

  it("keeps band width uniform", () => {
    const ls = gridLevels(base, 1);
    const step = ls[1]! - ls[0]!;
    for (let i = 1; i < ls.length; i++) expect(ls[i]! - ls[i - 1]!).toBeCloseTo(step, 12);
  });
});

describe("simulateGrid", () => {
  const pt = (price: number, quoteUsd = 1): PricePoint => ({ price, quoteUsd });

  it("a monotonic rise produces zero buys and a null win rate, never zero", () => {
    const pts = [pt(1), pt(1.01), pt(1.02), pt(1.03)];
    const r = simulateGrid(pts, base);
    expect(r.trades).toHaveLength(0);
    expect(r.roundTripsClosed).toBe(0);
    expect(r.winRatePct).toBeNull();
  });

  it("a dip-and-recover closes trips whose net is the band width, minus both fees", () => {
    // Open at 1; cross down through every buy band, then back up.
    const open = 1;
    const levels = gridLevels(base, open);
    const lowest = levels[0]!;
    const pts = [pt(open), pt(lowest - 0.001), pt(1.0299), pt(1.03)];
    const feePct = 0.05; // 0.05% per leg
    const r = simulateGrid(pts, { ...base, feePctPerLeg: feePct });
    expect(r.roundTripsClosed).toBeGreaterThan(0);
    const width = levels[1]! - levels[0]!;
    // each trip: buy qty = alloc/level (fee in quote), sell at level+1 (fee in
    // inventory): net fraction = width/(level+1) - alloc*(fee/level + ...).
    // The exact expression is messy; pin the sign and rough magnitude instead.
    for (const t of r.trips) expect(t.netQuote).toBeGreaterThan(0);
    const perTrip = r.trips[0]!.netQuote;
    expect(perTrip).toBeLessThan((base.capitalUsd / base.bandsPerSide) * width * 1.01);
  });

  it("fees larger than the band width make every closed trip a loss", () => {
    // Band width is 0.375% of price; charge 1% per leg (the 1% fee tier).
    const open = 1;
    const levels = gridLevels(base, open);
    const pts = [pt(open), pt(levels[0]! - 0.001), pt(1.03)];
    const r = simulateGrid(pts, { ...base, feePctPerLeg: 1 });
    expect(r.roundTripsClosed).toBeGreaterThan(0);
    expect(r.roundTripsWon).toBe(0);
    expect(r.winRatePct).toBe(0);
  });

  it("counts inventory deployment as a fraction of equity, not of initial capital", () => {
    // Buy everything at the bottom, then halve the price: deployment stays
    // measured against CURRENT equity, so it approaches but cannot exceed 1.
    const open = 1;
    const levels = gridLevels(base, open);
    const pts = [pt(open), pt(levels[0]! - 0.001), pt(0.4)];
    const r = simulateGrid(pts, base);
    expect(r.maxDeployedPct).toBeLessThanOrEqual(1);
    expect(r.openLots.length).toBe(8);
    expect(r.maxDeployedPct).toBeGreaterThan(0.9);
  });

  it("reports drawdown in USD, following the quote's own price moves", () => {
    // Quote halves in USD with the pool price flat: equity halves in USD even
    // though nothing traded. The drawdown must see what a USD investor saw.
    const pts = [pt(1, 1), pt(1, 0.5)];
    const r = simulateGrid(pts, base);
    expect(r.maxDrawdownPct).toBeCloseTo(50, 1);
  });

  it("hold-quote is the do-nothing baseline: flat when the quote is a stable", () => {
    const pts = [pt(1, 1), pt(0.9, 1), pt(1.1, 1)];
    const r = simulateGrid(pts, base);
    expect(r.holdQuoteUsd).toBeCloseTo(base.capitalUsd, 6);
  });

  it("hold-inventory converts all capital at the open and marks at the end", () => {
    const open = 1;
    const pts = [pt(open, 1), pt(2, 1)]; // inventory doubles
    const r = simulateGrid(pts, base);
    expect(r.holdBaseUsd).toBeCloseTo(base.capitalUsd * 2, 6);
  });

  it("never spends quote cash it does not have", () => {
    const open = 1;
    const levels = gridLevels(base, open);
    const pts = [pt(open), pt(levels[0]! - 0.001)];
    const r = simulateGrid(pts, base);
    const spent = r.trades.reduce((s, t) => s + t.quote, 0);
    expect(spent).toBeLessThanOrEqual(base.capitalUsd + 1e-9);
  });
});

describe("venue depth helpers", () => {
  it("prices stable-quoted depth directly from L and sqrtP", () => {
    // L=1e24, sqrtP=1 -> depth = 2e24/1e18 = 2e6 USD
    expect(poolDepthUsd(10n ** 24n, 2n ** 96n, "USDT", null)).toBeCloseTo(2e6, 0);
  });

  it("prices WBNB-quoted depth through the WBNB USD price", () => {
    const d = poolDepthUsd(10n ** 24n, 2n ** 96n, "WBNB", 600);
    expect(d).toBeCloseTo(2e6 * 600, 0);
  });

  it("refuses to price a quote it cannot price", () => {
    expect(poolDepthUsd(10n ** 24n, 2n ** 96n, "WBNB", null)).toBeNull();
    expect(poolDepthUsd(10n ** 24n, 2n ** 96n, "CAKE", 600)).toBeNull();
  });

  it("derives WBNB USD price from a WBNB/USDT pool (token0 is USDT)", () => {
    // P = WBNB per USDT = 1/600 -> sqrtP = sqrt(1/600); 2^96 * that.
    const sqrtP = Math.sqrt(1 / 600);
    expect(wbnbUsdFromPool(BigInt(Math.round(sqrtP * 2 ** 96)))).toBeCloseTo(600, 5);
  });

  it("sorts token0/token1 by address, not by pair-list order", () => {
    const addr = (t: string) =>
      t === "USDT" ? "0x55d398326f99059fF775485246999027B3197955" :
      t === "WBNB" ? "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" : undefined;
    // USDT (0x55...) sorts below WBNB (0xbb...): token0 = USDT.
    expect(sortToken0Token1("WBNB", "USDT", addr)).toEqual({ token0: "USDT", token1: "WBNB" });
    // Unknown token: refuse rather than guess.
    expect(sortToken0Token1("WBNB", "ZZZ", addr)).toBeNull();
  });
});
