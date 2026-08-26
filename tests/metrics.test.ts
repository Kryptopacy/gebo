import { describe, expect, it } from "vitest";
import { buildQualifiers, pct, METRIC_DEFS } from "../src/lib/metrics.ts";

describe("metric qualifiers (design law L2)", () => {
  it("every registry metric carries all four L2 fields plus defects", () => {
    for (const [id, def] of Object.entries(METRIC_DEFS)) {
      const q = buildQualifiers(id as keyof typeof METRIC_DEFS, 42);
      expect(q.formula.length).toBeGreaterThan(0);
      expect(q.denominator.length).toBeGreaterThan(0);
      expect(q.window.length).toBeGreaterThan(0);
      expect(q.costTreatment.length).toBeGreaterThan(0);
      expect(q.obsCount).toBe(42);
      expect(q.knownDefects.length).toBeGreaterThan(0);
      for (const d of q.knownDefects) expect(d.length).toBeGreaterThan(0);
    }
  });

  it("obsCount travels with the value, never assumed", () => {
    const a = buildQualifiers("uptime_7d", 20);
    const b = buildQualifiers("uptime_7d", 5000);
    expect(a.obsCount).toBe(20);
    expect(b.obsCount).toBe(5000);
    // Same definition otherwise: only n differs between two agents' rows.
    expect({ ...a, obsCount: 0 }).toEqual({ ...b, obsCount: 0 });
  });
});

describe("pct", () => {
  it("rounds to two decimals", () => {
    expect(pct(2, 3)).toBeCloseTo(66.67);
    expect(pct(1, 4)).toBe(25);
    expect(pct(0, 0)).toBe(0);
    expect(pct(96, 96)).toBe(100);
  });
});
