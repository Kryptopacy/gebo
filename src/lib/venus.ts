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
   */
  verdict: "no collateral enabled" | "no debt" | "safe" | "watch" | "at risk" | "liquidatable";
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
 */
export function verdictFor(healthFactor: number | null, hasPosition: boolean, hasDebt: boolean): HealthReport["verdict"] {
  if (!hasPosition) return "no collateral enabled";
  if (!hasDebt) return "no debt";
  if (healthFactor == null) return "no debt";
  if (healthFactor <= 1) return "liquidatable";
  if (healthFactor < 1.1) return "at risk";
  if (healthFactor < 1.5) return "watch";
  return "safe";
}

/** Scale a raw integer by 10^d into a JS number. Explicit, because the traps live here. */
function scale(raw: bigint, d: number): number {
  return Number(raw) / 10 ** d;
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

  for (const vToken of assets) {
    const [snapshot, market, symbol, price] = await Promise.all([
      pub.readContract({ address: vToken, abi: vTokenAbi, functionName: "getAccountSnapshot", args: [account] }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
      pub.readContract({ address: COMPTROLLER, abi: comptrollerAbi, functionName: "markets", args: [vToken] }) as Promise<readonly [boolean, bigint, boolean]>,
      pub.readContract({ address: vToken, abi: vTokenAbi, functionName: "symbol" }).catch(() => "?") as Promise<string>,
      pub.readContract({ address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [vToken] }) as Promise<bigint>,
    ]);

    const [err, vTokenBalance, borrowBalance, exchangeRateMantissa] = snapshot;
    if (err !== 0n) continue;

    /**
     * Underlying decimals, needed to interpret both the balance and the price.
     *
     * vBNB has no underlying() - the underlying is native BNB at 18 decimals - so a
     * failed read means 18 rather than an error.
     */
    let underlyingDecimals = 18;
    try {
      const underlying = (await pub.readContract({ address: vToken, abi: vTokenAbi, functionName: "underlying" })) as Address;
      underlyingDecimals = Number(await pub.readContract({ address: underlying, abi: erc20Abi, functionName: "decimals" }));
    } catch {
      underlyingDecimals = 18;
    }

    // exchangeRate is scaled 10^(18 + underlyingDecimals - 8), vTokens have 8 decimals.
    const suppliedUnderlying =
      scale(vTokenBalance, 8) * scale(exchangeRateMantissa, 18 + underlyingDecimals - 8);
    const borrowedUnderlying = scale(borrowBalance, underlyingDecimals);

    // Venus oracle prices are scaled to 36 - underlyingDecimals.
    const priceUsd = scale(price, 36 - underlyingDecimals);

    const suppliedUsd = suppliedUnderlying * priceUsd;
    const borrowedUsd = borrowedUnderlying * priceUsd;
    const collateralFactor = scale(market[1], 18);

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
    verdict: verdictFor(healthFactor, positions.length > 0, hasRealDebt),
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
    return (
      `${r.account} has $${r.totalSuppliedUsd.toFixed(2)} supplied and ` +
      (r.totalBorrowedUsd > 0
        ? `only $${r.totalBorrowedUsd.toFixed(6)} borrowed - below the $0.01 floor where a ratio means anything - `
        : `no debt `) +
      `at block ${r.blockNumber}, so no health factor applies. Liquidation is impossible without borrows.`
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
