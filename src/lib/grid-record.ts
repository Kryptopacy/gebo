/**
 * Grid strategy replay: the trading record for the grid reference agent.
 *
 * WHY REPLAY. A trading agent's record needs win rate, window and the risk
 * taken. The grid agent advises a mechanical strategy - a symmetric grid of
 * price levels - and the market it would have traded in is public data.
 * Replaying the advised grid over realized prices makes the MARKET the
 * grader, which is the only arrangement invariant 7 permits for an agent we
 * operate: we never score our own work, we publish what the price path did
 * to it.
 *
 * ORIENTATION. The pool's own price P is token1 denominated in token0
 * (V3 convention: P = 1.0001^tick = the price of one token0 in token1
 * units). The grid runs on P in that orientation: quote = token1 (the asset
 * the strategy starts in), inventory = token0 (bought as P falls through a
 * level - token0 cheap in token1 - and sold one band higher). Each point
 * also carries the quote token's USD price, so equity, PnL and drawdown are
 * reported in USD even when the quote is itself volatile (a crypto/crypto
 * pool like BTCB/WBNB). Realized/unrealized PnL are converted at the
 * window-end quote price - stated, not hidden.
 *
 * WHAT THIS IS NOT. It is not a live position and not a forward test. Fills
 * are simulated at band crossings (no slippage, no MEV, the intraperiod path
 * is approximated by the period close), and fees are modeled at the pool's
 * tier on each leg's notional. Every one of those limits ships in the
 * record's qualifiers - a measurement whose limits are visible is evidence;
 * one whose limits are hidden is marketing.
 *
 * MECHANICS. The agent advises: symmetric grid, +/-3% around the opening
 * price, eight bands per side. Concretely 17 price levels spanning
 * [0.97, 1.03] x open, buys on the eight levels below open (the strategy
 * starts entirely in the quote asset, so only those can fill), each lot
 * selling one band higher. A closed round-trip nets band width minus two
 * legs of pool fees; that is the number the win rate counts.
 */

/** One realized observation: pool price P (token1 per token0), and the quote token's (token1) USD price. */
export type PricePoint = { price: number; quoteUsd?: number };

export type GridConfig = {
  /** Lower price bound of the grid (0.97 x open for the agent's suggestion). */
  lowerPrice: number;
  /** Upper price bound (1.03 x open). */
  upperPrice: number;
  /** Bands per side, as the agent states it. 8 -> 17 levels total. */
  bandsPerSide: number;
  /** Starting capital, denominated in USD (converted to quote at open). */
  capitalUsd: number;
  /** Pool fee per leg, in percent (a 1.00% tier charges 1.00 here). */
  feePctPerLeg: number;
};

export type GridTrade = {
  side: "buy" | "sell";
  levelIdx: number;
  /** Price in pool orientation (token1 per token0). */
  price: number;
  /** Traded notional in quote units. */
  quote: number;
  feeQuote: number;
};

export type RoundTrip = {
  buyPrice: number;
  sellPrice: number;
  qtyBase: number;
  /** width minus both legs' fees, in quote units; positive = won. */
  netQuote: number;
};

export type GridRecord = {
  levels: number[];
  trades: GridTrade[];
  trips: RoundTrip[];
  roundTripsClosed: number;
  roundTripsWon: number;
  /** Null when nothing closed - absence, never a bare zero rate. */
  winRatePct: number | null;
  feesUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  /** Buy-and-hold the inventory asset with the same capital, marked at the end. */
  holdBaseUsd: number;
  /** Strategy total PnL minus buy-and-hold-inventory PnL. Negative = the DIY won. */
  edgeVsHoldBaseUsd: number;
  /** Do-nothing baseline: keep the starting quote asset, marked at the end. */
  holdQuoteUsd: number;
  /** Strategy total PnL minus the do-nothing baseline. */
  edgeVsHoldQuoteUsd: number;
  /** Peak-to-trough of strategy equity in USD (quote cash + inventory at market). */
  maxDrawdownPct: number;
  /** Peak share of equity sitting in the inventory asset. */
  maxDeployedPct: number;
  /** Open lots at the end, marked to the final price. */
  openLots: { buyPrice: number; qtyBase: number; usdAtEnd: number }[];
};

/** Price levels implied by the agent's symmetric-band suggestion. */
export function gridLevels(cfg: GridConfig, openPrice: number): number[] {
  const n = cfg.bandsPerSide * 2 + 1;
  const step = (cfg.upperPrice - cfg.lowerPrice) / (n - 1);
  return Array.from({ length: n }, (_, i) => cfg.lowerPrice + step * i);
}

/**
 * Replay the grid over a realized price series. Points must be in ascending
 * time order; each point's price is treated as the period's closing price,
 * so crossings that happen entirely inside a period are approximated - a
 * stated defect, not a hidden one.
 */
export function simulateGrid(points: PricePoint[], cfg: GridConfig): GridRecord {
  const open = points[0]?.price ?? cfg.lowerPrice;
  const quoteUsd0 = points[0]?.quoteUsd ?? 1;
  const quoteUsdEnd = points.length ? (points[points.length - 1]!.quoteUsd ?? 1) : 1;

  const levels = gridLevels(cfg, open);
  const fee = cfg.feePctPerLeg / 100;
  const capitalQuote = cfg.capitalUsd / quoteUsd0;

  // Per buy-level lot state. lot[i] holds inventory bought at levels[i]
  // waiting to sell at levels[i+1]. Allocation per level: capital / bands.
  const alloc = capitalQuote / cfg.bandsPerSide;
  const lots: ({ qtyBase: number; buyPrice: number } | null)[] = levels.map(() => null);

  let quoteCash = capitalQuote;
  let realizedQuote = 0;
  let feesQuote = 0;
  const trades: GridTrade[] = [];
  const trips: RoundTrip[] = [];

  // Equity in USD for drawdown/deployment: (quote cash + inventory at market)
  // x the quote's USD price at that moment.
  let peakEquityUsd = cfg.capitalUsd;
  let maxDrawdownPct = 0;
  let maxDeployedPct = 0;

  const equityUsdAt = (price: number, quoteUsd: number) =>
    (quoteCash + lots.reduce((sum, l) => sum + (l ? l.qtyBase * price : 0), 0)) * quoteUsd;

  let prev = open;

  for (const { price, quoteUsd } of points) {
    const qUsd = quoteUsd ?? 1;
    if (price < prev) {
      // Down move: fills are buys at every level crossed, high to low.
      for (let i = cfg.bandsPerSide - 1; i >= 0; i--) {
        const level = levels[i]!;
        if (prev > level && price <= level && !lots[i] && quoteCash >= alloc) {
          const grossQuote = alloc;
          const feeQuote = grossQuote * fee;
          const qty = (grossQuote - feeQuote) / level; // fee paid in the input (quote) asset
          lots[i] = { qtyBase: qty, buyPrice: level };
          quoteCash -= grossQuote;
          feesQuote += feeQuote;
          trades.push({ side: "buy", levelIdx: i, price: level, quote: grossQuote, feeQuote });
        }
      }
    } else if (price > prev) {
      // Up move: fills are sells at levels crossed, low to high. A lot bought
      // at levels[i] sells at levels[i+1].
      for (let i = 0; i < cfg.bandsPerSide; i++) {
        const sellLevel = levels[i + 1]!;
        if (prev < sellLevel && price >= sellLevel && lots[i]) {
          const lot = lots[i]!;
          const grossQuote = lot.qtyBase * sellLevel;
          const feeQuote = grossQuote * fee; // fee paid in the input (inventory) asset
          const netQuote = grossQuote - feeQuote - lot.qtyBase * lot.buyPrice;
          quoteCash += grossQuote - feeQuote;
          realizedQuote += netQuote;
          feesQuote += feeQuote;
          lots[i] = null;
          trades.push({ side: "sell", levelIdx: i + 1, price: sellLevel, quote: grossQuote, feeQuote });
          trips.push({ buyPrice: lot.buyPrice, sellPrice: sellLevel, qtyBase: lot.qtyBase, netQuote });
        }
      }
    }
    prev = price;

    const equityUsd = equityUsdAt(price, qUsd);
    if (equityUsd > peakEquityUsd) peakEquityUsd = equityUsd;
    const dd = peakEquityUsd > 0 ? ((peakEquityUsd - equityUsd) / peakEquityUsd) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    const invQuote = lots.reduce((sum, l) => sum + (l ? l.qtyBase * price : 0), 0);
    const equityQuote = quoteCash + invQuote;
    const deployed = equityQuote > 0 ? invQuote / equityQuote : 0;
    if (deployed > maxDeployedPct) maxDeployedPct = deployed;
  }

  const endPrice = points.length ? points[points.length - 1]!.price : cfg.lowerPrice;
  const openLots = lots.flatMap((l) =>
    l ? [{ buyPrice: l.buyPrice, qtyBase: l.qtyBase, usdAtEnd: l.qtyBase * endPrice * quoteUsdEnd }] : []);
  const unrealizedQuote = lots.reduce((s, l) => s + (l ? l.qtyBase * (endPrice - l.buyPrice) : 0), 0);

  // Hold-the-inventory counterfactual: same capital, all in token1's
  // counterpart (token0, the grid's inventory) at open, marked at the end.
  // Hold-the-quote counterfactual: do nothing with the starting asset; its
  // USD value moves only with the quote's own price.
  const holdQty = capitalQuote / open;
  const holdBaseUsd = holdQty * endPrice * quoteUsdEnd;
  const holdQuoteUsd = capitalQuote * quoteUsdEnd;
  const totalPnlUsd = (realizedQuote + unrealizedQuote) * quoteUsdEnd;

  const roundTripsWon = trips.filter((t) => t.netQuote > 0).length;

  return {
    levels,
    trades,
    trips,
    roundTripsClosed: trips.length,
    roundTripsWon,
    winRatePct: trips.length >= 1 ? (roundTripsWon / trips.length) * 100 : null,
    feesUsd: feesQuote * quoteUsdEnd,
    realizedPnlUsd: realizedQuote * quoteUsdEnd,
    unrealizedPnlUsd: unrealizedQuote * quoteUsdEnd,
    totalPnlUsd,
    holdBaseUsd,
    edgeVsHoldBaseUsd: totalPnlUsd - (holdBaseUsd - cfg.capitalUsd),
    holdQuoteUsd,
    edgeVsHoldQuoteUsd: totalPnlUsd - (holdQuoteUsd - cfg.capitalUsd),
    maxDrawdownPct,
    maxDeployedPct,
    openLots,
  };
}

/** tick -> price of token0 denominated in token1... no: token1 per token0 (V3 convention). */
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

// ── venue depth: the agent's pool-selection rule, as pure functions ──────────

/** Tokens quoted ~$1 on BNB Chain; every token in the index is 18 decimals. */
export const STABLES = new Set(["USDT", "USDC", "BUSD", "FDUSD"]);

/**
 * Marginal depth in USD: 2 * L * sqrt(P), priced in the pool's token1, the
 * on-chain value of active in-range liquidity around the current tick. A
 * DEPTH PROXY, not TVL (TVL needs full position ranges), but it ranks venues
 * by what a grid or rebalance cares about: capital near the price.
 *
 * token1Usd: 1 for stables; the WBNB USD price for WBNB-quoted pools; null
 * when token1 cannot be priced, in which case depth is unpriceable (null).
 */
export function poolDepthUsd(
  liquidity: bigint | number,
  sqrtPriceX96: bigint | number,
  token1: string,
  wbnbUsd: number | null,
): number | null {
  if (token1 === "WBNB") {
    if (wbnbUsd == null || wbnbUsd <= 0) return null;
  } else if (!STABLES.has(token1)) {
    return null;
  }
  const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
  const token1Usd = token1 === "WBNB" ? wbnbUsd! : 1;
  return (2 * Number(liquidity) * sqrtP * token1Usd) / 1e18;
}

/**
 * USD price of WBNB implied by a WBNB/USDT pool's state: P = token1 per
 * token0, token0 is USDT (lower address), so 1/P = USDT per WBNB.
 */
export function wbnbUsdFromPool(sqrtPriceX96: bigint | number): number {
  const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
  return 1 / (sqrtP * sqrtP);
}

/** Address sort decides V3 token0/token1 orientation. */
export function sortToken0Token1(
  tokenA: string,
  tokenB: string,
  addr: (t: string) => string | undefined,
): { token0: string; token1: string } | null {
  const a = addr(tokenA);
  const b = addr(tokenB);
  if (!a || !b) return null;
  return a.toLowerCase() < b.toLowerCase()
    ? { token0: tokenA, token1: tokenB }
    : { token0: tokenB, token1: tokenA };
}
