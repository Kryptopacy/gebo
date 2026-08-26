/**
 * Venus health factor, computed from chain.
 *
 * The substance behind the seeded reference agent. "Is my lending position about to
 * be liquidated" is the most mechanically verifiable question in the judged four:
 * the answer is a ratio of collateral to borrows, both readable, with no room for
 * taste. That is exactly why it was chosen - an agent whose output cannot be checked
 * cannot have a track record worth publishing.
 *
 * WHY NOT JUST getAccountLiquidity. The comptroller returns liquidity and shortfall
 * in USD, which answers "is there headroom" but not "how much headroom relative to
 * the debt". A position with $10 of headroom is comfortable against $20 of borrows
 * and terrifying against $20,000. The ratio is the informative figure, so the
 * per-market snapshot is read and the ratio computed, with liquidity and shortfall
 * reported alongside as Venus's own view.
 *
 * DECIMALS ARE THE TRAP. Venus mixes 18-decimal mantissas, per-market underlying
 * decimals, and an oracle price scaled to 36 minus underlying decimals. Getting this
 * wrong yields a plausible-looking number that is wrong by orders of magnitude -
 * the same class of error as reading an 18-decimal stablecoin as 6. Every scale
 * conversion here is explicit and commented.
 */
import { createPublicClient, http, fallback, parseAbi, type Address, type PublicClient } from "viem";
import { bsc } from "viem/chains";

const COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;

const comptrollerAbi = parseAbi([
  "function getAssetsIn(address account) view returns (address[])",
  "function getAccountLiquidity(address account) view returns (uint256, uint256, uint256)",
  "function markets(address vToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isVenus)",
  "function oracle() view returns (address)",
  "function closeFactorMantissa() view returns (uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
  // The authoritative market list. Hardcoding vToken addresses instead of reading
  // this produced a best-APR scan that matched zero markets - five plausible
  // addresses, zero of them verified first.
  "function getAllMarkets() view returns (address[])",
]);

const vTokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function getAccountSnapshot(address account) view returns (uint256, uint256, uint256, uint256)",
  "function underlying() view returns (address)",
  "function decimals() view returns (uint8)",
]);

const oracleAbi = parseAbi([
  "function getUnderlyingPrice(address vToken) view returns (uint256)",
]);

const erc20Abi = parseAbi(["function decimals() view returns (uint8)"]);

export type MarketPosition = {
  vToken: Address;
  symbol: string;
  /** Underlying supplied, in whole tokens. */
  supplied: number;
  /** Underlying borrowed, in whole tokens. */
  borrowed: number;
  /** USD value of the supply, before the collateral factor. */
  suppliedUsd: number;
  borrowedUsd: number;
  /** Fraction of this collateral that counts toward borrowing power. */
  collateralFactor: number;
};

export type HealthReport = {
  account: Address;
  blockNumber: bigint;
  /** Markets the account has entered. Empty means no position at all. */
  positions: MarketPosition[];
  /** Sum of collateral value already weighted by each collateral factor. */
  borrowingPowerUsd: number;
  totalBorrowedUsd: number;
  totalSuppliedUsd: number;
  /**
   * Borrowing power divided by debt.
   *
   * Above 1 means solvent; at or below 1 the position is liquidatable. Null when
   * there is no debt, because a ratio with a zero denominator is not infinity, it
   * is undefined - and rendering Infinity as a health score would be absurd.
   */
  healthFactor: number | null;
  /** Venus's own figures, for cross-checking the ratio above. */
  liquidityUsd: number;
  shortfallUsd: number;
  /**
   * How much of the debt a liquidator may close in one go, and their bonus.
   *
   * Null when the comptroller does not expose them. Venus's mainnet comptroller is
   * an EIP-2535 Diamond and reverts `liquidationIncentiveMantissa` with "Diamond:
   * Function does not exist", so these are read defensively. They are context, not
   * the answer - letting their absence kill the health factor would be the tail
   * wagging the dog, and reporting a default as though it were measured would be
   * worse.
   */
  closeFactor: number | null;
  liquidationIncentive: number | null;
  /**
   * Plain-language verdict.
   *
   * `no collateral enabled` rather than `no position`, because the basis is
   * getAssetsIn, which lists markets the account ENTERED as collateral - not markets
   * where it merely holds vTokens. Thirteen real vUSDT holders came back empty from
   * that call during validation. For borrowing power that is the correct basis, since
   * un-entered supply grants none; but reporting it as "no position" told a supplier
   * they had nothing, which is false.
   *
   * `dust debt` is deliberately separate from `no debt`. An account carrying
   * $0.000007 of debt does not have none, and folding it into "no debt" would state
   * something untrue while also looking like we had failed to detect it. Naming the
   * case says the debt was seen, measured, and judged too small for a ratio.
   */
  verdict:
    | "no collateral enabled"
    | "no debt"
    | "dust debt"
    | "safe"
    | "watch"
    | "at risk"
    | "liquidatable";
};

function client(): PublicClient {
  return createPublicClient({
    chain: bsc,
    transport: fallback(
      [
        process.env.BSC_MAINNET_RPC,
        "https://bsc-dataseed1.bnbchain.org",
        "https://binance.llamarpc.com",
        "https://bsc-dataseed2.bnbchain.org",
      ]
        .filter(Boolean)
        .map((u) => http(u as string, { timeout: 20_000, retryCount: 1 })),
    ),
  }) as PublicClient;
}

/**
 * Classify a health factor.
 *
 * Thresholds are published rather than hidden, because a verdict without its
 * threshold is an opinion wearing a number's clothes. 1.1 is the conventional
 * danger line on Venus: a 10% adverse move puts the position underwater.
 *
 * Takes the debt AMOUNT rather than a boolean so zero and dust stay distinguishable.
 * A boolean forced the caller to decide, and the caller folded dust into "no debt".
 */
export function verdictFor(
  healthFactor: number | null,
  hasPosition: boolean,
  borrowedUsd: number,
): HealthReport["verdict"] {
  if (!hasPosition) return "no collateral enabled";
  if (borrowedUsd <= 0) return "no debt";
  if (borrowedUsd < DUST_DEBT_USD) return "dust debt";
  if (healthFactor == null) return "no debt";
  if (healthFactor <= 1) return "liquidatable";
  if (healthFactor < 1.1) return "at risk";
  if (healthFactor < 1.5) return "watch";
  return "safe";
}

/**
 * Below this, debt is dust and the ratio stops being informative.
 *
 * Found against a live position: an account with $465.89 of borrowing power and a
 * fraction of a cent of debt produced a health factor of 65,029,489, printed as
 * though it were a measurement. A ratio against a near-zero denominator is noise
 * wearing a number's clothes - the same failure as dividing by zero, only quieter
 * because it does not raise.
 *
 * One cent, because Venus positions are denominated in USD and a sub-cent balance
 * cannot be liquidated for a profit at any incentive.
 */
const DUST_DEBT_USD = 0.01;

/** Scale a raw integer by 10^d into a JS number. Explicit, because the traps live here. */
function scale(raw: bigint, d: number): number {
  return Number(raw) / 10 ** d;
}

export async function healthFactorFor(account: Address): Promise<HealthReport> {
  const pub = client();

  const [blockNumber, assets, liquidity, oracle] = await Promise.all([
    pub.getBlockNumber(),
    pub.readContract({ address: COMPTROLLER, abi: comptrollerAbi, functionName: "getAssetsIn", args: [account] }) as Promise<readonly Address[]>,
    pub.readContract({ address: COMPTROLLER, abi: comptrollerAbi, functionName: "getAccountLiquidity", args: [account] }) as Promise<readonly [bigint, bigint, bigint]>,
    pub.readContract({ address: COMPTROLLER, abi: comptrollerAbi, functionName: "oracle" }) as Promise<Address>,
  ]);

  // Context, not the answer. Absent on the Diamond comptroller, so read separately
  // and allowed to be null rather than defaulted to a number nobody measured.
  const closeF = await pub
    .readContract({ address: COMPTROLLER, abi: comptrollerAbi, functionName: "closeFactorMantissa" })
    .catch(() => null) as bigint | null;
  const incentive = await pub
    .readContract({ address: COMPTROLLER, abi: comptrollerAbi, functionName: "liquidationIncentiveMantissa" })
    .catch(() => null) as bigint | null;

  const positions: MarketPosition[] = [];
  let borrowingPowerUsd = 0;
  let totalBorrowedUsd = 0;
  let totalSuppliedUsd = 0;

  /**
   * Batched, because sequential reads made this agent lose its own benchmark.
   *
   * The first version looped markets and awaited four reads each, then a fifth and
   * sixth for underlying decimals. On a six-market position that is over thirty
   * round trips and it measured 10,921 ms - slower than doing the job by hand, which
   * would have shown up in the Agent Advantage Report as an agent disadvantage when
   * it was really an artefact of this loop.
   *
   * Two multicalls instead: one for snapshots, market data, symbols and prices, then
   * one for the underlying decimals of whatever markets came back. allowFailure so a
   * single reverting market degrades that market rather than the whole answer.
   */
  const perMarket = await pub.multicall({
    contracts: assets.flatMap((v) => [
      { address: v, abi: vTokenAbi, functionName: "getAccountSnapshot" as const, args: [account] },
      { address: COMPTROLLER, abi: comptrollerAbi, functionName: "markets" as const, args: [v] },
      { address: v, abi: vTokenAbi, functionName: "symbol" as const },
      { address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice" as const, args: [v] },
      { address: v, abi: vTokenAbi, functionName: "underlying" as const },
    ]),
    allowFailure: true,
  });

  /**
   * Underlying decimals, one batched pass.
   *
   * vBNB has no underlying() - the underlying is native BNB at 18 decimals - so a
   * failed read means 18 rather than an error.
   */
  const underlyings: (Address | null)[] = assets.map((_, i) => {
    const r = perMarket[i * 5 + 4];
    return r?.status === "success" ? (r.result as Address) : null;
  });
  const decimalReads = await pub.multicall({
    contracts: underlyings
      .filter((u): u is Address => u !== null)
      .map((u) => ({ address: u, abi: erc20Abi, functionName: "decimals" as const })),
    allowFailure: true,
  });
  const decimalsFor = new Map<Address, number>();
  {
    let k = 0;
    for (const u of underlyings) {
      if (u === null) continue;
      const r = decimalReads[k++];
      decimalsFor.set(u, r?.status === "success" ? Number(r.result) : 18);
    }
  }

  for (let i = 0; i < assets.length; i++) {
    const vToken = assets[i]!;
    const snapRes = perMarket[i * 5];
    const marketRes = perMarket[i * 5 + 1];
    const symRes = perMarket[i * 5 + 2];
    const priceRes = perMarket[i * 5 + 3];
    if (snapRes?.status !== "success" || marketRes?.status !== "success" || priceRes?.status !== "success") continue;

    const [err, vTokenBalance, borrowBalance, exchangeRateMantissa] =
      snapRes.result as readonly [bigint, bigint, bigint, bigint];
    if (err !== 0n) continue;

    const symbol = symRes?.status === "success" ? String(symRes.result) : "?";
    const underlying = underlyings[i];
    const underlyingDecimals = underlying ? (decimalsFor.get(underlying) ?? 18) : 18;

    // exchangeRate is scaled 10^(18 + underlyingDecimals - 8), vTokens have 8 decimals.
    const suppliedUnderlying =
      scale(vTokenBalance, 8) * scale(exchangeRateMantissa, 18 + underlyingDecimals - 8);
    const borrowedUnderlying = scale(borrowBalance, underlyingDecimals);

    // Venus oracle prices are scaled to 36 - underlyingDecimals.
    const priceUsd = scale(priceRes.result as bigint, 36 - underlyingDecimals);

    const suppliedUsd = suppliedUnderlying * priceUsd;
    const borrowedUsd = borrowedUnderlying * priceUsd;
    const collateralFactor = scale((marketRes.result as readonly [boolean, bigint, boolean])[1], 18);

    totalSuppliedUsd += suppliedUsd;
    totalBorrowedUsd += borrowedUsd;
    borrowingPowerUsd += suppliedUsd * collateralFactor;

    if (suppliedUnderlying > 0 || borrowedUnderlying > 0) {
      positions.push({
        vToken, symbol,
        supplied: suppliedUnderlying,
        borrowed: borrowedUnderlying,
        suppliedUsd, borrowedUsd, collateralFactor,
      });
    }
  }

  // Dust debt is treated as no debt, so the ratio is never taken against noise.
  const hasRealDebt = totalBorrowedUsd >= DUST_DEBT_USD;
  const healthFactor = hasRealDebt ? borrowingPowerUsd / totalBorrowedUsd : null;

  return {
    account,
    blockNumber,
    positions,
    borrowingPowerUsd,
    totalBorrowedUsd,
    totalSuppliedUsd,
    healthFactor,
    liquidityUsd: scale(liquidity[1], 18),
    shortfallUsd: scale(liquidity[2], 18),
    closeFactor: closeF == null ? null : scale(closeF, 18),
    liquidationIncentive: incentive == null ? null : scale(incentive, 18),
    verdict: verdictFor(healthFactor, positions.length > 0, totalBorrowedUsd),
  };
}

/**
 * A one-line answer, with its own qualifiers attached.
 *
 * The agent's deliverable is this string, so it has to carry the denominator with
 * it: a health factor without the collateral and debt it came from is a bare number,
 * which design law L2 forbids.
 */
export function summarise(r: HealthReport): string {
  if (r.verdict === "no collateral enabled") {
    return (
      `No Venus market is enabled as collateral for ${r.account} at block ${r.blockNumber}. ` +
      `This is read from getAssetsIn, so vTokens held without entering a market are not ` +
      `counted - they grant no borrowing power and cannot be liquidated.`
    );
  }
  if (r.healthFactor == null) {
    /**
     * Say which case it is. Folding dust into "no debt" would assert something false
     * and simultaneously look like a detection failure, so the sub-cent amount is
     * printed to show it was seen, measured, and judged too small to divide by.
     */
    const debtClause =
      r.totalBorrowedUsd > 0
        ? `\$${r.totalBorrowedUsd.toFixed(8)} borrowed, which is below the \$${DUST_DEBT_USD.toFixed(2)} floor where a ratio carries information`
        : `no debt`;
    return (
      `${r.account} has \$${r.totalSuppliedUsd.toFixed(2)} supplied and ${debtClause} ` +
      `at block ${r.blockNumber}, so no health factor is reported. Liquidation needs debt worth taking.`
    );
  }
  /**
   * Liquidation terms are appended only when they were actually readable.
   *
   * The Diamond comptroller does not expose them, and asserting a close factor we
   * could not read would be exactly the fabricated figure this project refuses.
   */
  const terms =
    r.closeFactor != null && r.liquidationIncentive != null
      ? ` Liquidatable at or below 1.0; a liquidator may close ${(r.closeFactor * 100).toFixed(0)}% of the debt ` +
        `at a ${((r.liquidationIncentive - 1) * 100).toFixed(0)}% incentive.`
      : ` Liquidatable at or below 1.0. Liquidation terms were not readable from the comptroller.`;

  return (
    `Health factor ${r.healthFactor.toFixed(4)} (${r.verdict}) for ${r.account} at block ${r.blockNumber}: ` +
    `$${r.borrowingPowerUsd.toFixed(2)} of borrowing power against $${r.totalBorrowedUsd.toFixed(2)} borrowed ` +
    `across ${r.positions.length} market(s). Venus reports $${r.liquidityUsd.toFixed(2)} liquidity and ` +
    `$${r.shortfallUsd.toFixed(2)} shortfall.` + terms
  );
}

/**
 * Every market Venus lists, straight from the comptroller. The previous version
 * hardcoded five "well-known" vToken addresses and then filtered them through
 * markets(); every one failed that check, so the yield task had no truth to grade
 * against. Reading the list from chain is both shorter and self-verifying.
 */
async function listedMarkets(pub: PublicClient): Promise<Address[]> {
  return (await pub.readContract({
    address: COMPTROLLER, abi: comptrollerAbi, functionName: "getAllMarkets",
  })) as readonly Address[] as Address[];
}

const BLOCKS_PER_YEAR = 10_512_000;

const rateAbi = parseAbi([
  "function supplyRatePerBlock() view returns (uint256)",
  // Liquidity filter. A quoted APR without money behind it is how vUST's
  // broken-rate 415% would top the ranking - technically computable, worthless
  // as advice. Markets under MIN_LIQUIDITY_USD are excluded and named.
  "function getCash() view returns (uint256)",
]);

/** Below this much lendable USD, an APR is a curiosity, not a yield opportunity. */
const MIN_LIQUIDITY_USD = 50_000;

export type SupplyApr = {
  symbol: string;
  vToken: Address;
  /** Simple annualised percentage, understated per the block-time note above. */
  aprPct: number;
  /** Lendable underlying at current oracle prices, the filter's basis. */
  cashUsd: number;
};

export type BestSupplyApr = {
  blockNumber: bigint;
  /** Liquid markets only, best first. */
  markets: SupplyApr[];
  /** Markets excluded by the liquidity floor, so the omission is auditable. */
  excluded: { symbol: string; aprPct: number; cashUsd: number }[];
  best: SupplyApr | null;
};

export async function bestSupplyApr(): Promise<BestSupplyApr> {
  const pub = client();
  const [blockNumber, markets_, oracle] = await Promise.all([
    pub.getBlockNumber(),
    listedMarkets(pub),
    pub.readContract({ address: COMPTROLLER, abi: comptrollerAbi, functionName: "oracle" }) as Promise<Address>,
  ]);
  if (!markets_.length) return { blockNumber, markets: [], excluded: [], best: null };

  const perMarket = await pub.multicall({
    contracts: markets_.flatMap((v) => [
      { address: v, abi: vTokenAbi, functionName: "symbol" as const },
      { address: v, abi: rateAbi, functionName: "supplyRatePerBlock" as const },
      { address: v, abi: rateAbi, functionName: "getCash" as const },
      { address: v, abi: vTokenAbi, functionName: "underlying" as const },
      { address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice" as const, args: [v] },
    ]),
    allowFailure: true,
  });

  // Underlying decimals for whatever markets resolved, one batched pass. vBNB has
  // no underlying(); a failed read there means native BNB at 18.
  const underlyings: (Address | null)[] = markets_.map((_, i) => {
    const r = perMarket[i * 5 + 3];
    return r?.status === "success" ? (r.result as Address) : null;
  });
  const decimalReads = await pub.multicall({
    contracts: underlyings
      .filter((u): u is Address => u !== null)
      .map((u) => ({ address: u, abi: erc20Abi, functionName: "decimals" as const })),
    allowFailure: true,
  });
  const decimalsFor = new Map<Address, number>();
  {
    let k = 0;
    for (const u of underlyings) {
      if (u === null) { k++; continue; }
      const d = decimalReads[k++];
      decimalsFor.set(u, d?.status === "success" ? Number(d.result) : 18);
    }
  }

  const markets: SupplyApr[] = [];
  const excluded: BestSupplyApr["excluded"] = [];
  for (let i = 0; i < markets_.length; i++) {
    const sym = perMarket[i * 5];
    const rate = perMarket[i * 5 + 1];
    const cash = perMarket[i * 5 + 2];
    const priceR = perMarket[i * 5 + 4];
    if (sym?.status !== "success" || rate?.status !== "success") continue;

    const fracPerBlock = Number(rate.result as bigint) / 1e18;
    if (!Number.isFinite(fracPerBlock) || fracPerBlock <= 0) continue;
    const aprPct = Math.round(fracPerBlock * BLOCKS_PER_YEAR * 10000) / 100;

    let cashUsd = 0;
    if (cash?.status === "success" && priceR?.status === "success") {
      const u = underlyings[i];
      const dec = u ? decimalsFor.get(u) ?? 18 : 18;
      // Oracle prices are scaled to 36 minus underlying decimals - the same
      // conversion healthFactorFor makes, for the same reason.
      const price = Number(priceR.result as bigint) / 10 ** (36 - dec);
      cashUsd = (Number(cash.result as bigint) / 10 ** dec) * price;
    }

    const entry: SupplyApr = { symbol: String(sym.result), vToken: markets_[i]!, aprPct, cashUsd };
    if (cashUsd >= MIN_LIQUIDITY_USD) markets.push(entry);
    else excluded.push(entry);
  }
  markets.sort((a, b) => b.aprPct - a.aprPct);
  return {
    blockNumber, markets, excluded,
    best: markets[0] ?? null,
  };
}
