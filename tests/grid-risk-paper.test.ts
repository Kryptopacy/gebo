/**
 * Grid ruin model + paper-mode scoring: the pure decision surfaces, pinned.
 *
 * The ruin estimate is the spec's grid.ruinProbabilityEstimate and the thing
 * a hirer would most want to misread, so its honesty properties are tested:
 * thin samples return "accumulating" instead of a number, the probability is
 * monotone in volatility, and the qualifiers carry the model. The paper
 * scoring is mechanical - the tests pin the exact rule so it cannot drift
 * into a rating.
 */
import { describe, it, expect } from "vitest";
import {
  estimateRuin, normalCdf, ruinQualifiers, RUIN_MIN_POINTS, LN_TICK,
  type TickSample,
} from "../src/lib/grid-risk.ts";
import {
  decideHealth, scoreDecision, HEALTH_ACT_UTILISATION, HEALTH_WATCH_UTILISATION,
} from "../src/lib/paper.ts";

function hourly(n: number, startTick = -66000, driftPerHour = 0): TickSample[] {
  const t0 = Date.now() - n * 3_600_000;
  return Array.from({ length: n + 1 }, (_, i) => ({
    at: new Date(t0 + i * 3_600_000),
    tick: Math.round(startTick + driftPerHour * i),
  }));
}

describe("normalCdf", () => {
  it("is 0.5 at zero and symmetric", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("estimateRuin", () => {
  it("refuses to publish below the sample thresholds - accumulating, not guessing", () => {
    const r = estimateRuin(hourly(24));
    expect("accumulating" in r && r.accumulating).toBe(24);
    expect("probability" in r).toBe(false);
  });

  it("publishes at >= 48 hourly points spanning >= 72h", () => {
    const r = estimateRuin(hourly(72));
    expect("probability" in r).toBe(true);
    if ("probability" in r) {
      expect(r.points).toBe(72);
      expect(r.probability).toBeGreaterThanOrEqual(0);
      expect(r.probability).toBeLessThanOrEqual(1);
    }
  });

  it("is monotone in volatility: more tick movement, higher ruin probability", () => {
    // deterministic alternating ticks of two amplitudes
    const mk = (amp: number): TickSample[] => {
      const t0 = Date.now() - 72 * 3_600_000;
      return Array.from({ length: 73 }, (_, i) => ({
        at: new Date(t0 + i * 3_600_000),
        tick: i % 2 === 0 ? -66000 : -66000 + amp,
      }));
    };
    const calm = estimateRuin(mk(5));
    const wild = estimateRuin(mk(400));
    expect("probability" in calm && "probability" in wild).toBe(true);
    if ("probability" in calm && "probability" in wild) {
      expect(wild.probability).toBeGreaterThan(calm.probability);
      // 400 ticks/hour is ~4%/h -> 7d sigma ~52%: exiting a +/-10% range is
      // strongly likely though not mathematically certain.
      expect(wild.probability).toBeGreaterThan(0.8);
    }
  });

  it("skips non-hourly gaps so a cron outage cannot masquerade as flat volatility", () => {
    // 72h of samples but with a 6-hour hole in the middle: only pairs with
    // ~1h spacing count.
    const withHole: TickSample[] = [
      ...hourly(36).slice(0, 37),
      ...hourly(36).slice(1).map((s) => ({ at: new Date(s.at.getTime() + 6 * 3_600_000), tick: s.tick })),
    ];
    const r = estimateRuin(withHole);
    expect("accumulating" in r).toBe(true);
    if ("accumulating" in r) expect(r.accumulating).toBeLessThan(72);
  });

  it("zero-volatility pool publishes ~zero probability, not NaN", () => {
    const r = estimateRuin(hourly(72, -66000, 0));
    expect("probability" in r).toBe(true);
    if ("probability" in r) expect(r.probability).toBeLessThan(0.01);
  });

  it("qualifiers name the model, the sample, the range and the horizon", () => {
    const r = estimateRuin(hourly(72, -66000, 3));
    if ("probability" in r) {
      const q = ruinQualifiers(r);
      expect(q).toContain("log-normal");
      expect(q).toContain("hourly");
      expect(q).toContain("+/-10%");
      expect(q).toContain("7 days");
    } else throw new Error("expected a published estimate");
  });
});

describe("decideHealth (paper decision rule)", () => {
  it("thresholds are fixed and disclosed", () => {
    expect(HEALTH_WATCH_UTILISATION).toBe(0.85);
    expect(HEALTH_ACT_UTILISATION).toBe(0.95);
  });
  it("decides ok / watch / act by utilisation", () => {
    expect(decideHealth(0.3)).toBe("ok");
    expect(decideHealth(0.85)).toBe("watch");
    expect(decideHealth(0.95)).toBe("act");
  });
});

describe("scoreDecision (mechanical, not a rating)", () => {
  it("a watch/act call is correct when utilisation rose >= 2 points", () => {
    expect(scoreDecision("watch", 0.86, 0.90)).toEqual({ outcome: "correct", score: 1 });
    expect(scoreDecision("act", 0.96, 0.97)).toEqual({ outcome: "incorrect", score: 0 });
  });
  it("an ok call is correct when the warning never became warranted", () => {
    expect(scoreDecision("ok", 0.5, 0.6)).toEqual({ outcome: "correct", score: 1 });
    expect(scoreDecision("ok", 0.5, 0.87)).toEqual({ outcome: "incorrect", score: 0 });
  });
  it("LN_TICK sanity: ln(1.0001)", () => {
    expect(LN_TICK).toBeCloseTo(Math.log(1.0001), 12);
  });
});
