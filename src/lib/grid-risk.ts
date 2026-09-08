/**
 * Grid ruin-probability model (spec: grid.ruinProbabilityEstimate).
 *
 * A grid strategy's ruin mode is the price leaving its range: inventory goes
 * one-sided and the position stops being a grid. The spec asks for the
 * probability of that outcome, and users demanded it by name
 * (STRATEGY.md, ranked demand).
 *
 * THE MODEL, DISCLOSED RATHER THAN BURIED:
 *   P(price exits a +/-10% range within 7 days)
 *   under a log-normal random walk with zero drift,
 *   sigma estimated from OUR OWN hourly tick snapshots of the pool
 *   (V3 observe() history reaches only ~4h on BSC pools - measured - so the
 *   estimate is built from pool_tick_snapshots, accumulated by the
 *   opportunity cron, and publishes only once the sample is statistically
 *   meaningful: >= 48 hourly deltas spanning >= 72h).
 *
 * A thin-sample probability would be dishonest precision, so below the
 * thresholds the field is null with the accumulating count - unmeasured,
 * never guessed (invariant 9).
 *
 * TWO-SIDED REFLECTION APPROXIMATION:
 *   P(max |ln(S_t/S_0)| > ln(1+R)) ~= 2 * (1 - Phi(ln(1+R) / (sigma * sqrt(T))))
 * which slightly overstates (it ignores the barrier being two-sided
 * absorbing rather than reflecting) - conservative by construction, and the
 * bias note travels with the field.
 */

/** ln(1.0001): one V3 tick in natural-log price space. */
export const LN_TICK = Math.log(1.0001);

export const RUIN_MIN_POINTS = 48;
export const RUIN_MIN_SPAN_HOURS = 72;
export const RUIN_RANGE_PCT = 10;
export const RUIN_HORIZON_DAYS = 7;
/** Snapshot cadence the model expects; the cron enforces it. */
export const SNAPSHOT_MIN_INTERVAL_MIN = 55;

/** Standard normal CDF, Abramowitz-Stegun 26.2.17, |error| < 7.5e-8. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export type TickSample = { at: Date; tick: number };

export type RuinEstimate = {
  probability: number;
  /** sigma of the 7-day log return, from hourly realized vol. */
  sigma7d: number;
  points: number;
  windowHours: number;
  rangePct: number;
  horizonDays: number;
};

/**
 * Hourly tick samples -> ruin estimate. Samples must be ordered oldest-first;
 * each consecutive pair with ~1h between them contributes one hourly log
 * return (tick delta * LN_TICK). Pairs with larger gaps are skipped so a
 * cron outage cannot masquerade as flat volatility.
 */
export function estimateRuin(
  samples: TickSample[],
  opts: { rangePct?: number; horizonDays?: number } = {},
): RuinEstimate | { accumulating: number; spanHours: number } {
  const rangePct = opts.rangePct ?? RUIN_RANGE_PCT;
  const horizonDays = opts.horizonDays ?? RUIN_HORIZON_DAYS;

  const rets: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i]!.at.getTime() - samples[i - 1]!.at.getTime()) / 3_600_000;
    if (dt < 0.75 || dt > 1.5) continue; // not an hourly pair
    rets.push((samples[i]!.tick - samples[i - 1]!.tick) * LN_TICK);
  }
  const spanHours = samples.length > 1
    ? (samples[samples.length - 1]!.at.getTime() - samples[0]!.at.getTime()) / 3_600_000
    : 0;
  if (rets.length < RUIN_MIN_POINTS || spanHours < RUIN_MIN_SPAN_HOURS) {
    return { accumulating: rets.length, spanHours };
  }

  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sdHour = Math.sqrt(Math.max(variance, 0));
  const hours = horizonDays * 24;
  const sigmaH = sdHour * Math.sqrt(hours);
  const barrier = Math.log(1 + rangePct / 100);
  const probability = Math.min(1, Math.max(0, 2 * (1 - normalCdf(barrier / Math.max(sigmaH, 1e-9)))));

  return { probability, sigma7d: sigmaH, points: rets.length, windowHours: spanHours, rangePct, horizonDays };
}

/** The qualifiers that must travel with any published estimate (L2). */
export function ruinQualifiers(r: RuinEstimate): string {
  return (
    `log-normal random-walk model, zero drift assumed; sigma from ${r.points} hourly tick ` +
    `observations over ${Math.round(r.windowHours)}h; +/-${r.rangePct}% reference range over ` +
    `${r.horizonDays} days; two-sided reflection approximation (slightly conservative); ` +
    `past volatility does not bound future volatility`
  );
}
