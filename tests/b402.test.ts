import { describe, it, expect } from "vitest";
import { analyseCatalogue, baseUnitsToTokens, type B402Resource } from "../src/lib/b402.ts";

/**
 * B402 Bazaar analysis.
 *
 * The point of these tests is that the claims this project publishes about someone
 * else's catalogue are computed, not asserted. If the concentration figure or the
 * quality-block count is going on a page, it has to be reproducible from a fixture.
 */

function res(over: Partial<B402Resource> & { payTo?: string } = {}): B402Resource {
  const { payTo = "0xAAA", ...rest } = over;
  return {
    resource: "https://example.com/api/a",
    type: "http",
    x402Version: 2,
    description: null,
    accepts: [
      {
        scheme: "eip3009",
        network: "eip155:56",
        asset: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
        maxAmountRequired: "250000000000000000",
        payTo,
      },
    ],
    lastUpdated: 1787422009257,
    ...rest,
  };
}

describe("baseUnitsToTokens", () => {
  it("treats BSC stablecoins as 18 decimals, not 6", () => {
    // The whole reason this helper exists. Reading 250000000000000000 as 6-decimal
    // would price a $0.25 call at $250,000,000,000 - a 10^12 error.
    expect(baseUnitsToTokens("250000000000000000")).toBeCloseTo(0.25, 10);
    expect(baseUnitsToTokens("1000000000000000000")).toBe(1);
    expect(baseUnitsToTokens("100000000000000000")).toBeCloseTo(0.1, 10);
  });

  it("refuses a non-integer rather than coercing it", () => {
    expect(baseUnitsToTokens("0.25")).toBeNull();
    expect(baseUnitsToTokens("")).toBeNull();
    expect(baseUnitsToTokens("abc")).toBeNull();
  });
});

describe("analyseCatalogue", () => {
  it("reports payee concentration against its own denominator", () => {
    // The finding the reported total hides: many listings, few payees.
    const items = [
      ...Array.from({ length: 9 }, (_, i) =>
        res({ resource: `https://a${i}.example.com/x`, payTo: "0xDOMINANT" }),
      ),
      res({ resource: "https://b.example.com/x", payTo: "0xOTHER" }),
    ];
    const a = analyseCatalogue(items, 10);
    expect(a.observed).toBe(10);
    expect(a.distinctPayees).toBe(2);
    expect(a.topPayee).toBe("0xdominant");
    expect(a.topPayeeCount).toBe(9);
    expect(a.topPayeeSharePct).toBeCloseTo(90, 6);
  });

  it("lowercases payees so one address is not counted as two", () => {
    const items = [
      res({ resource: "https://a.example.com/x", payTo: "0xAbC" }),
      res({ resource: "https://b.example.com/x", payTo: "0xabc" }),
    ];
    const a = analyseCatalogue(items, 2);
    expect(a.distinctPayees).toBe(1);
    expect(a.topPayeeCount).toBe(2);
  });

  it("counts the documented quality block, which live records omit entirely", () => {
    // Binance documents l30DaysTotalCalls / l30DaysUniquePayers / lastCalledAt.
    // Zero of 976 live records carried it when measured. A registry that renders
    // usage from this field would be rendering nothing at all.
    const withNone = [res(), res({ resource: "https://b.example.com/x" })];
    expect(analyseCatalogue(withNone, 2).withQuality).toBe(0);

    const withOne = [
      res(),
      res({ resource: "https://b.example.com/x", quality: { l30DaysTotalCalls: 12 } }),
    ];
    expect(analyseCatalogue(withOne, 2).withQuality).toBe(1);
  });

  it("does not count an empty quality object as usage data", () => {
    const items = [res({ quality: {} }), res({ resource: "https://b.example.com/x", quality: null })];
    expect(analyseCatalogue(items, 2).withQuality).toBe(0);
  });

  it("separates hostnames from payees, because one payee fronts many hosts", () => {
    const items = [
      res({ resource: "https://one.example.com/a", payTo: "0xSAME" }),
      res({ resource: "https://two.example.com/a", payTo: "0xSAME" }),
      res({ resource: "https://two.example.com/b", payTo: "0xSAME" }),
    ];
    const a = analyseCatalogue(items, 3);
    expect(a.distinctHosts).toBe(2);
    expect(a.distinctPayees).toBe(1);
  });

  it("keeps the reported total distinct from what was observed", () => {
    // If the API claims more than it serves, both numbers must survive so the
    // page can state the gap instead of picking whichever looks better.
    const a = analyseCatalogue([res()], 976);
    expect(a.reportedTotal).toBe(976);
    expect(a.observed).toBe(1);
  });

  it("counts payment options separately from listings, and shares against them", () => {
    // The bug this pins: a listing may offer several accepts entries, so network,
    // asset, scheme and payee counts exceed the listing count. Dividing them by
    // the listing total printed "eip155:56 101.0%" against the live catalogue -
    // 986 accepts across 976 listings. A share over 100% is the denominator
    // mismatch design law L2 exists to prevent, committed in our own reporting.
    const items = [
      res({
        accepts: [
          { scheme: "eip3009", network: "eip155:56", asset: "0xA", maxAmountRequired: "1", payTo: "0xP" },
          { scheme: "permit2-exact", network: "eip155:56", asset: "0xA", maxAmountRequired: "1", payTo: "0xP" },
        ],
      }),
      res({ resource: "https://b.example.com/x", payTo: "0xP" }),
    ];
    const a = analyseCatalogue(items, 2);
    expect(a.observed).toBe(2);
    expect(a.acceptsTotal).toBe(3);

    const networkShare = (a.networks[0]!.n / a.acceptsTotal) * 100;
    expect(networkShare).toBeLessThanOrEqual(100);
    expect(networkShare).toBeCloseTo(100, 6);

    // One payee holding all three options is 100% of options, not 150% of listings.
    expect(a.topPayeeCount).toBe(3);
    expect(a.topPayeeSharePct).toBeCloseTo(100, 6);
  });

  it("survives a listing that prices nothing or is not a URL", () => {
    const items = [
      res(),
      { ...res({ resource: "not-a-url" }), accepts: [] },
    ];
    const a = analyseCatalogue(items, 2);
    expect(a.observed).toBe(2);
    expect(a.distinctPayees).toBe(1);
    expect(a.distinctHosts).toBe(1);
  });

  it("reports the price spread in whole tokens", () => {
    const items = [
      res({ accepts: [{ scheme: "eip3009", network: "eip155:56", asset: "0xA", maxAmountRequired: "100000000000000000", payTo: "0xA" }] }),
      res({ resource: "https://b.example.com/x", accepts: [{ scheme: "eip3009", network: "eip155:56", asset: "0xA", maxAmountRequired: "2000000000000000000", payTo: "0xA" }] }),
    ];
    const a = analyseCatalogue(items, 2);
    expect(a.priceMin).toBeCloseTo(0.1, 10);
    expect(a.priceMax).toBeCloseTo(2, 10);
  });
});
