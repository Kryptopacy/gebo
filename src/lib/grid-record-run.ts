/**
 * The grid agent's trading record: compute, write, report.
 *
 * Shared by scripts/grid-track-record.ts (manual runs) and
 * /api/cron/grid-record (daily refresh), so the two cannot drift.
 *
 * THE RECORD. The rubric for trading agents asks for win rate, the window it
 * was earned over, and the risk taken. This produces exactly that, by
 * replaying the agent's advised grid (symmetric +/-3%, eight bands per side,
 * on the deepest-liquidity eligible pool in its category - the same
 * selection the agent itself runs) over the price path that actually
 * happened. The market is the grader; this only reports what the price path
 * did to the strategy.
 *
 * TWO WINDOWS, NOT ONE. Grid results are window-sensitive - a monotonic week
 * produces zero round-trips and a losing-vs-hold record while a ranging week
 * produces the opposite - so the record publishes 7d (fresh, comparable with
 * the site's other 7d metrics) AND 30d (enough oscillation for a win rate to
 * exist at all). Publishing only the flattering window would be the lie
 * invariant 2 exists to prevent.
 *
 * THE PRICE PATH. Free BSC RPCs cap eth_getLogs lookback (publicnode: 5,000
 * blocks, ~4h) so 30 days of pool Swap events are not reachable from this
 * deployment. The path therefore comes from Binance 1-minute closes for both
 * pool tokens, ratioed into the pool's own orientation (token1 per token0).
 * Arbitrage keeps that ratio within the pool's fee tier of the pool's tick,
 * and the peg is CHECKED, not assumed: the live tick is read and the
 * deviation ships in the qualifiers. The strategy's economics (fee tier,
 * band width) are the pool's own.
 */
import postgres from "postgres";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { simulateGrid, poolDepthUsd, wbnbUsdFromPool, sortToken0Token1, type PricePoint } from "./grid-record.ts";

/** The agent this record belongs to: our reference grid agent. */
export const GRID_AGENT_TOKEN_ID = 259575;
/** All metric ids this module owns; also the staleness-delete set. */
export const GRID_METRICS = [
  "grid_win_rate_7d", "grid_edge_vs_hold_7d", "grid_max_drawdown_7d",
  "grid_win_rate_30d", "grid_edge_vs_hold_30d", "grid_max_drawdown_30d",
] as const;
const WINDOWS = [7, 30] as const;
const OBS_FLOOR = 500;
const KLINES = "https://data-api.binance.vision/api/v3/klines";
const STABLES = new Set(["USDT", "USDC", "BUSD", "FDUSD"]);
const SYM: Record<string, string> = { WBNB: "BNBUSDT", ETH: "ETHUSDT", BTCB: "BTCUSDT", CAKE: "CAKEUSDT" };
const TOKEN_ADDR: Record<string, string> = {
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  FDUSD: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
};

export type GridRecordOutcome = {
  pool: { label: string; ref: string; feePct: number | null };
  pegDevPct: number;
  windows: {
    suffix: string;
    observations: number;
    written: { metricId: string; value: number }[];
    summary: string;
  }[];
  dry: boolean;
};

type Kline = [number, string, string, string, string, ...unknown[]];

async function fetchKlines(symbol: string, days: number): Promise<Kline[]> {
  const now = Date.now();
  const cutoff = now - days * 86_400_000;
  const out: Kline[] = [];
  let endTime = now;
  for (;;) {
    const url = `${KLINES}?symbol=${symbol}&interval=1m&endTime=${endTime}&limit=1000`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    let batch: Kline[];
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      batch = (await res.json()) as Kline[];
    } finally {
      clearTimeout(timer);
    }
    out.push(...batch);
    const earliest = batch[0]![0];
    // Stop at the window edge or when the exchange runs out of history;
    // a sign-flipped while-condition once turned this into an infinite loop.
    if (batch.length < 1000 || earliest <= cutoff) break;
    endTime = earliest - 1;
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/**
 * The full record computation. Throws on unrecoverable failure (caller
 * decides how to report); returns per-window summaries when it completes.
 * With dry=true nothing is written.
 */
export async function runGridRecord(
  sql: postgres.Sql,
  opts: { dry?: boolean; log?: (line: string) => void } = {},
): Promise<GridRecordOutcome> {
  const dry = opts.dry ?? false;
  const log = opts.log ?? (() => {});

  // ── the venue: exactly what the agent advises ──────────────────────────────
  // The selection rule is recomputed from RAW on-chain fields (liquidity,
  // sqrtPriceX96) rather than the cron's stored depthUsd: production's cron
  // only refreshes that field every 10 minutes, and a stale payload once made
  // this evaluate a 0.25%-fee pool the agent would never advise. Same rule,
  // derived at read time - the two cannot drift apart.
  const poolRows = await sql<
    { ref: string; label: string; fee_pct: number | null; token_a: string; token_b: string; liquidity: string; sqrt_price_x96: string }[]
  >`
    select ref, label, (payload->>'feePct')::numeric as fee_pct,
           payload->>'tokenA' as token_a, payload->>'tokenB' as token_b,
           payload->>'liquidity' as liquidity, payload->>'sqrtPriceX96' as sqrt_price_x96
    from opportunities
    where chain_id = 56 and venue = 'pancakeswap-v3' and eligible and category = 'grid'`;

  const TOKEN_ADDR_FN = (t: string) => TOKEN_ADDR[t];
  // WBNB USD price from the deepest WBNB/USDT pool in the set.
  let wbnbUsd: number | null = null;
  let wbnbUsdLiq = 0n;
  for (const r of poolRows) {
    const pair = sortToken0Token1(r.token_a, r.token_b, TOKEN_ADDR_FN);
    if (!pair) continue;
    const isWbnbUsdt =
      (pair.token0 === "USDT" && pair.token1 === "WBNB") || (pair.token0 === "WBNB" && pair.token1 === "USDT");
    if (!isWbnbUsdt) continue;
    const liq = BigInt(r.liquidity);
    if (liq <= wbnbUsdLiq) continue;
    wbnbUsd = wbnbUsdFromPool(BigInt(r.sqrt_price_x96));
    wbnbUsdLiq = liq;
  }

  let pool: { ref: string; label: string; fee_pct: number | null; token_a: string; token_b: string } | null = null;
  let bestDepth = -1;
  for (const r of poolRows) {
    // The grid eligibility rule the cron applies: fee tier no higher than
    // 0.25% (higher tiers erode grid edge) and NOT a stable/stable pair
    // (which never moves enough to grid). Replicated here because the stored
    // eligible flag can be minutes stale when the old cron wrote it.
    const feePct = r.fee_pct == null ? null : Number(r.fee_pct);
    if (feePct == null || feePct > 0.25) continue;
    if (STABLES.has(r.token_a) && STABLES.has(r.token_b)) continue;
    const pair = sortToken0Token1(r.token_a, r.token_b, TOKEN_ADDR_FN);
    if (!pair) continue;
    const d = poolDepthUsd(BigInt(r.liquidity), BigInt(r.sqrt_price_x96), pair.token1, wbnbUsd);
    if (d != null && d > bestDepth) {
      bestDepth = d;
      pool = { ...r, fee_pct: feePct };
    }
  }
  if (!pool) throw new Error("no priceable eligible grid pool in the opportunities index");

  const orient = sortToken0Token1(pool.token_a, pool.token_b, TOKEN_ADDR_FN)!;
  const { token0, token1 } = orient;
  const sym0 = STABLES.has(token0) ? null : SYM[token0];
  const sym1 = STABLES.has(token1) ? null : SYM[token1];
  if (!sym0 || !sym1) throw new Error(`pool ${pool.label} (${token0}/${token1}) has no mapped exchange symbol`);

  log(`  venue selected by marginal depth: $${bestDepth.toExponential(2)} (WBNB $${wbnbUsd?.toFixed(2)})`);

  // ── realized price paths: Binance 1m closes for both tokens ────────────────
  const [k0, k1] = await Promise.all([
    fetchKlines(sym0, Math.max(...WINDOWS)),
    fetchKlines(sym1, Math.max(...WINDOWS)),
  ]);
  const closeOf = (k: Kline[]) => new Map<number, number>(k.map((x) => [x[0], Number(x[4])]));
  const c0 = closeOf(k0);
  const c1 = closeOf(k1);
  const all: PricePoint[] = [];
  for (const [t, usd0] of c0) {
    const usd1 = c1.get(t);
    if (usd1 === undefined) continue; // timestamp mismatch: skip, do not interpolate
    // Pool price P = token1 per token0 = price of one token0 in token1 units
    // = usd(token0)/usd(token1). The grid runs on P: quote = token1,
    // inventory = token0 (bought as P falls, sold one band higher).
    all.push({ price: usd0 / usd1, quoteUsd: usd1 });
  }

  // ── peg check: pool tick vs exchange ratio, live ───────────────────────────
  const pub = createPublicClient({
    chain: bsc,
    transport: http(process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com", { timeout: 30_000 }),
  });
  const slot0 = (await pub.readContract({
    address: pool.ref as Address,
    abi: parseAbi(["function slot0() view returns (uint160, int24, uint16, uint16, uint8, uint8, bool)"]),
    functionName: "slot0",
  })) as readonly [bigint, number, ...unknown[]];
  const poolPrice = Math.pow(1.0001, slot0[1]); // token1 per token0
  const lastUsd0 = Number(k0[k0.length - 1]![4]);
  const lastUsd1 = Number(k1[k1.length - 1]![4]);
  const exchangePrice = lastUsd0 / lastUsd1;
  const pegDevPct = ((poolPrice - exchangePrice) / exchangePrice) * 100;

  log(`  peg check pool tick implies ${poolPrice.toPrecision(6)} vs exchange ${exchangePrice.toPrecision(6)} -> deviation ${pegDevPct.toFixed(3)}%`);

  if (Math.abs(pegDevPct) > 3) {
    throw new Error(
      `peg deviation ${pegDevPct.toFixed(2)}% exceeds the grid's own +/-3% width: ` +
      `the replay would not describe this pool; nothing written`,
    );
  }

  const model =
    `Replay of the agent's advised grid (+/-3%, 8 bands/side) on PancakeSwap V3 ` +
    `(pool ${pool.label}) over realized 1-minute closes (Binance ${sym0} and ${sym1}, ` +
    `ratioed into the pool's ${token1}-per-${token0} orientation), fees at the pool's ` +
    `${pool.fee_pct ?? "?"}% tier; peg deviation pool-vs-exchange at compute time: ` +
    `${pegDevPct.toFixed(3)}%.`;
  const defects = [
    "Simulated fills: no slippage, no MEV, no queue position; minute-closing prices approximate the intraminute path.",
    `Fees modeled at the pool's ${pool.fee_pct ?? "?"}% tier per leg on traded notional, in the input asset.`,
    "Price path is the exchange ratio the pool arbitrages to, not the pool's own tick-by-tick swaps: free BSC RPCs cap log lookback at ~4h, so a pool-native path this long is not reachable from this deployment.",
    "Backtest over realized windows: not a live position and not a forward test.",
    "Pool selection is deepest-by-marginal-liquidity, exactly what the agent advises; venue risk is part of what is being measured.",
    "Grid results are window-sensitive by nature; this record publishes every window it claims, not a selected one.",
  ];

  const outcome: GridRecordOutcome = {
    pool: { label: pool.label, ref: pool.ref, feePct: pool.fee_pct },
    pegDevPct,
    windows: [],
    dry,
  };

  for (const days of WINDOWS) {
    const points = all.slice(-days * 1_440);
    const suffix = `${days}d`;
    const t0s = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const t1s = new Date().toISOString().slice(0, 10);

    if (points.length < OBS_FLOOR) {
      outcome.windows.push({
        suffix,
        observations: points.length,
        written: [],
        summary: `below the ${OBS_FLOOR}-observation floor - nothing written`,
      });
      continue;
    }

    const open = points[0]!.price;
    const cfg = {
      lowerPrice: open * 0.97,
      upperPrice: open * 1.03,
      bandsPerSide: 8,
      capitalUsd: 1_000,
      feePctPerLeg: pool.fee_pct ?? 0,
    };
    const rec = simulateGrid(points, cfg);

    const summary =
      `${rec.trades.length} fills (${rec.roundTripsClosed} round-trips closed, ` +
      `${rec.roundTripsWon} won), total PnL $${rec.totalPnlUsd.toFixed(2)}, ` +
      `edge vs hold $${rec.edgeVsHoldBaseUsd.toFixed(2)} / vs do-nothing $${rec.edgeVsHoldQuoteUsd.toFixed(2)}, ` +
      `max drawdown ${rec.maxDrawdownPct.toFixed(2)}%`;

    const rows: { metric_id: string; value: number | null; note: string }[] = [
      {
        metric_id: `grid_win_rate_${suffix}`,
        value: rec.winRatePct == null ? null : Math.round(rec.winRatePct * 100) / 100,
        note: `won / closed round-trips = ${rec.roundTripsWon} / ${rec.roundTripsClosed}`,
      },
      {
        metric_id: `grid_edge_vs_hold_${suffix}`,
        value: Math.round(rec.edgeVsHoldBaseUsd * 100) / 100,
        note: `strategy total PnL $${rec.totalPnlUsd.toFixed(2)} minus buy-and-hold-inventory $${(rec.holdBaseUsd - cfg.capitalUsd).toFixed(2)} on $${cfg.capitalUsd}; vs doing nothing (hold quote): $${rec.edgeVsHoldQuoteUsd.toFixed(2)}`,
      },
      {
        metric_id: `grid_max_drawdown_${suffix}`,
        value: Math.round(rec.maxDrawdownPct * 100) / 100,
        note: `peak-to-trough of strategy equity (cash + inventory at market); peak deployment ${(rec.maxDeployedPct * 100).toFixed(0)}% of capital`,
      },
    ];

    const written: { metricId: string; value: number }[] = [];
    for (const r of rows) {
      // A null (nothing closed) must not be flattened into a zero win rate:
      // invariant 9, a failed measurement never renders as zero. Skip the row.
      if (r.value === null) continue;
      if (!dry) {
        await sql`
          insert into metric_values (chain_id, token_id, metric_id, "window", value, obs_count, qualifiers, computed_at)
          values (56, ${GRID_AGENT_TOKEN_ID}, ${r.metric_id}, ${suffix}, ${r.value}, ${points.length},
            ${sql.json({
              formula: r.note,
              denominator: model,
              window: `${t0s}..${t1s} (${days} days)`,
              costTreatment: `fees modeled at ${pool.fee_pct ?? "?"}% per leg and included in every figure; gas excluded`,
              obsCount: points.length,
              obsFloor: OBS_FLOOR,
              knownDefects: defects,
            })}::jsonb,
            now())
          on conflict (chain_id, token_id, metric_id, "window") do update set
            value = excluded.value,
            obs_count = excluded.obs_count,
            qualifiers = excluded.qualifiers,
            computed_at = now()`;
      }
      written.push({ metricId: r.metric_id, value: r.value });
    }
    outcome.windows.push({ suffix, observations: points.length, written, summary });
  }

  if (!dry) {
    // Stale-record hygiene, same rule as the liveness metrics: a record older
    // than 26h stops rendering rather than wearing out its welcome. Rows
    // written above are seconds old and survive.
    await sql`
      delete from metric_values
      where metric_id = any(${sql.array([...GRID_METRICS])})
        and computed_at < now() - interval '26 hours'`;
  }

  return outcome;
}
