/**
 * Opportunity surface indexer — the cold-start answer.
 *
 * GEBO does not wait for agents to list themselves. It indexes the work that
 * exists on chain right now, so every category page holds real rows whether or
 * not a competent agent has appeared. Agents then attach to that surface.
 *
 *   rebalancing / grid   PancakeSwap V3 pools — live tick, liquidity, fee tier
 *   yield / health       Venus markets — supply and borrow rates, collateral
 *                        factors, liquidation parameters
 *
 * Addresses verified against developer.pancakeswap.finance and confirmed live
 * by call rather than assumed. Rate assumptions are recorded on each row so the
 * UI can display them alongside the number, per design law L2.
 */
import "dotenv/config";
import {
  createPublicClient, http, fallback, parseAbi, getAddress,
  type Address, type PublicClient,
} from "viem";
import { bsc } from "viem/chains";
import postgres from "postgres";

// ── PancakeSwap V3 (BSC mainnet) ───────────────────────────────────────────
const PCS_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as const;
const FEE_TIERS = [100, 500, 2500, 10000] as const;
const TICK_SPACING: Record<number, number> = { 100: 1, 500: 10, 2500: 50, 10000: 200 };

// ── Venus (BSC mainnet) ────────────────────────────────────────────────────
const VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;
/**
 * Venus computes rates per block and its core pool assumes 3-second blocks
 * (blocksPerYear = 10,512,000). BSC now produces blocks faster than that, so a
 * naive annualisation understates the true rate. The assumption is carried on
 * every row rather than silently baked in.
 */
const VENUS_BLOCKS_PER_YEAR = 10_512_000;

const TOKENS: Record<string, Address> = {
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  FDUSD: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
};

const PAIRS: [string, string][] = [
  ["WBNB", "USDT"], ["CAKE", "WBNB"], ["BTCB", "WBNB"], ["ETH", "WBNB"],
  ["USDC", "USDT"], ["WBNB", "BUSD"], ["BTCB", "USDT"], ["ETH", "USDT"],
  ["CAKE", "USDT"], ["FDUSD", "USDT"], ["WBNB", "USDC"], ["WBNB", "FDUSD"],
];

const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
]);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);
const comptrollerAbi = parseAbi([
  "function getAllMarkets() view returns (address[])",
  "function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa, bool isVenus)",
  "function closeFactorMantissa() view returns (uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
]);
const vTokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function underlying() view returns (address)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function reserveFactorMantissa() view returns (uint256)",
]);

const client = createPublicClient({
  chain: bsc,
  transport: fallback([
    "https://bsc-rpc.publicnode.com",
    "https://binance.llamarpc.com",
    "https://bsc-dataseed1.bnbchain.org",
    "https://bsc-dataseed2.bnbchain.org",
  ].map((u) => http(u, { timeout: 25_000, retryCount: 2 }))),
  batch: { multicall: { wait: 24, batchSize: 400 } },
}) as PublicClient;

type Opportunity = {
  id: string;
  category: "rebalancing" | "grid" | "yield" | "health";
  chain_id: number;
  venue: string;
  ref: string;
  label: string;
  payload: Record<string, unknown>;
  eligible: boolean;
  ineligible_reason: string | null;
};

const out: Opportunity[] = [];
const head = await client.getBlockNumber();
console.log(`\n  BSC head ${head.toLocaleString()}`);

// ── PancakeSwap V3 pools ───────────────────────────────────────────────────
console.log(`\n  PancakeSwap V3 — resolving pools for ${PAIRS.length} pairs x ${FEE_TIERS.length} fee tiers`);

const poolQueries: { a: string; b: string; fee: number }[] = [];
for (const [a, b] of PAIRS) for (const fee of FEE_TIERS) poolQueries.push({ a, b, fee });

const poolAddrs = await client.multicall({
  contracts: poolQueries.map((q) => ({
    address: PCS_FACTORY, abi: factoryAbi, functionName: "getPool" as const,
    args: [TOKENS[q.a]!, TOKENS[q.b]!, q.fee],
  })),
  allowFailure: true,
});

const live = poolQueries
  .map((q, i) => ({ ...q, pool: poolAddrs[i]?.status === "success" ? (poolAddrs[i]!.result as Address) : null }))
  .filter((x) => x.pool && x.pool !== "0x0000000000000000000000000000000000000000");

console.log(`    ${live.length} pools exist of ${poolQueries.length} combinations`);

const [slots, liqs] = await Promise.all([
  client.multicall({
    contracts: live.map((p) => ({ address: p.pool!, abi: poolAbi, functionName: "slot0" as const })),
    allowFailure: true,
  }),
  client.multicall({
    contracts: live.map((p) => ({ address: p.pool!, abi: poolAbi, functionName: "liquidity" as const })),
    allowFailure: true,
  }),
]);

// Reserves held by the pool tell us realised depth without a price oracle.
const balances = await client.multicall({
  contracts: live.flatMap((p) => [
    { address: TOKENS[p.a]!, abi: erc20Abi, functionName: "balanceOf" as const, args: [p.pool!] },
    { address: TOKENS[p.b]!, abi: erc20Abi, functionName: "balanceOf" as const, args: [p.pool!] },
  ]),
  allowFailure: true,
});

let poolsIndexed = 0;
for (let i = 0; i < live.length; i++) {
  const p = live[i]!;
  const slot = slots[i];
  const liq = liqs[i];
  if (slot?.status !== "success") continue;

  const s = slot.result as readonly [bigint, number, number, number, number, number, boolean];
  const liquidity = liq?.status === "success" ? (liq.result as bigint) : 0n;
  const balA = balances[i * 2]?.status === "success" ? (balances[i * 2]!.result as bigint) : 0n;
  const balB = balances[i * 2 + 1]?.status === "success" ? (balances[i * 2 + 1]!.result as bigint) : 0n;

  const label = `${p.a}/${p.b} ${(p.fee / 10_000).toFixed(2)}%`;
  const hasLiquidity = liquidity > 0n;
  const payload = {
    pool: p.pool,
    tokenA: p.a, tokenB: p.b,
    tokenAAddress: TOKENS[p.a], tokenBAddress: TOKENS[p.b],
    feeTier: p.fee,
    feePct: p.fee / 10_000,
    tickSpacing: TICK_SPACING[p.fee] ?? null,
    currentTick: s[1],
    sqrtPriceX96: s[0].toString(),
    liquidity: liquidity.toString(),
    reserveA: balA.toString(),
    reserveB: balB.toString(),
    unlocked: s[6],
    observationCardinality: s[3],
    /** MasterChefV3 may custody the LP NFT — rebalancing a farmed position is
     *  withdraw -> modify -> re-stake, and CAKE harvest enters the accounting. */
    masterChefV3: "0x556B9306565093C855AEA9AE92A594704c2Cd59e",
    readAtBlock: head.toString(),
  };

  out.push({
    id: `rebalancing:56:pancakeswap-v3:${p.pool}`,
    category: "rebalancing", chain_id: 56, venue: "pancakeswap-v3",
    ref: p.pool!, label, payload,
    eligible: hasLiquidity,
    ineligible_reason: hasLiquidity ? null : "pool exists but holds no active liquidity",
  });

  // Grid viability is a different question about the same pool: tighter fee
  // tiers and deeper books favour grids, so it gets its own row and threshold.
  const gridViable = hasLiquidity && p.fee <= 2500;
  out.push({
    id: `grid:56:pancakeswap-v3:${p.pool}`,
    category: "grid", chain_id: 56, venue: "pancakeswap-v3",
    ref: p.pool!, label, payload,
    eligible: gridViable,
    ineligible_reason: gridViable ? null : hasLiquidity ? "fee tier above 0.25% erodes grid edge" : "no active liquidity",
  });
  poolsIndexed++;
}
console.log(`    indexed ${poolsIndexed} pools -> ${poolsIndexed * 2} opportunity rows`);

// ── Venus markets ──────────────────────────────────────────────────────────
console.log(`\n  Venus — reading markets from comptroller`);
let vTokens: readonly Address[] = [];
try {
  vTokens = await client.readContract({
    address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "getAllMarkets",
  }) as readonly Address[];
  console.log(`    ${vTokens.length} markets listed`);
} catch (e: any) {
  console.log(`    comptroller unreadable: ${String(e?.shortMessage ?? e).slice(0, 90)}`);
}

if (vTokens.length) {
  // A failed read must not become zero (invariant 9): the Comptroller on BSC
  // is a Diamond proxy with no liquidationIncentiveMantissa facet - the call
  // reverts, and coercing it to 0n made the table print "-100.0%" everywhere.
  const [closeFactor, liqIncentive] = await Promise.all([
    client.readContract({ address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "closeFactorMantissa" }).catch(() => null),
    client.readContract({ address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "liquidationIncentiveMantissa" }).catch(() => null),
  ]);

  const fields = ["symbol", "supplyRatePerBlock", "borrowRatePerBlock", "totalBorrows", "getCash", "reserveFactorMantissa"] as const;
  const reads = await client.multicall({
    contracts: vTokens.flatMap((v) => fields.map((fn) => ({ address: v, abi: vTokenAbi, functionName: fn as any }))),
    allowFailure: true,
  });
  const marketInfo = await client.multicall({
    contracts: vTokens.map((v) => ({ address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "markets" as const, args: [v] })),
    allowFailure: true,
  });

  let indexed = 0;
  for (let i = 0; i < vTokens.length; i++) {
    const v = vTokens[i]!;
    const base = i * fields.length;
    const get = (k: number) => (reads[base + k]?.status === "success" ? reads[base + k]!.result : null);

    const symbol = (get(0) as string) ?? v.slice(0, 8);
    const supplyRate = (get(1) as bigint) ?? 0n;
    const borrowRate = (get(2) as bigint) ?? 0n;
    const totalBorrows = (get(3) as bigint) ?? 0n;
    const cash = (get(4) as bigint) ?? 0n;
    const reserveFactor = (get(5) as bigint) ?? 0n;

    const mi = marketInfo[i]?.status === "success"
      ? (marketInfo[i]!.result as readonly [boolean, bigint, boolean]) : null;
    const collateralFactor = mi ? Number(mi[1]) / 1e18 : null;
    const isListed = mi ? mi[0] : false;

    // Simple annualisation. Compounded APY is not shown because the compounding
    // frequency depends on interaction, which we cannot observe per market.
    const supplyApr = (Number(supplyRate) / 1e18) * VENUS_BLOCKS_PER_YEAR * 100;
    const borrowApr = (Number(borrowRate) / 1e18) * VENUS_BLOCKS_PER_YEAR * 100;
    const utilisation = cash + totalBorrows > 0n
      ? Number(totalBorrows) / Number(cash + totalBorrows) : 0;

    const payload = {
      vToken: v,
      symbol,
      supplyAprPct: Number(supplyApr.toFixed(4)),
      borrowAprPct: Number(borrowApr.toFixed(4)),
      rateBasis: "simple annualisation of per-block rate",
      blocksPerYearAssumed: VENUS_BLOCKS_PER_YEAR,
      blocksPerYearCaveat: "Venus core assumes 3s blocks; BSC is faster, so this understates the true rate",
      utilisation: Number(utilisation.toFixed(4)),
      totalBorrows: totalBorrows.toString(),
      cash: cash.toString(),
      reserveFactor: Number(reserveFactor) / 1e18,
      collateralFactor,
      closeFactor: closeFactor == null ? null : Number(closeFactor) / 1e18,
      liquidationIncentive: liqIncentive == null ? null : Number(liqIncentive) / 1e18,
      liquidationIncentiveNote: liqIncentive == null
        ? "unmeasured - the Comptroller's Diamond facets expose no incentive getter"
        : null,
      isListed,
      readAtBlock: head.toString(),
    };

    const hasDepth = cash + totalBorrows > 0n;
    out.push({
      id: `yield:56:venus:${v}`,
      category: "yield", chain_id: 56, venue: "venus",
      ref: v, label: `${symbol} supply`, payload,
      eligible: isListed && hasDepth && supplyApr > 0,
      ineligible_reason: !isListed ? "market not listed" : !hasDepth ? "no liquidity" : supplyApr <= 0 ? "zero supply rate" : null,
    });

    // Health-factor work only exists where borrowing is possible at all.
    const borrowable = isListed && collateralFactor !== null && collateralFactor > 0;
    out.push({
      id: `health:56:venus:${v}`,
      category: "health", chain_id: 56, venue: "venus",
      ref: v, label: `${symbol} collateral`, payload,
      eligible: borrowable,
      ineligible_reason: borrowable ? null : "cannot be used as collateral — no liquidation risk to manage",
    });
    indexed++;
  }
  console.log(`    indexed ${indexed} markets -> ${indexed * 2} opportunity rows`);
}

// ── persist ────────────────────────────────────────────────────────────────
const url = process.env.DATABASE_URL;
if (!url) {
  console.log(`\n  DATABASE_URL not set — writing data/opportunities.json instead`);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("data", { recursive: true });
  writeFileSync("data/opportunities.json", JSON.stringify(out, null, 2));
} else {
  const sql = postgres(url, { prepare: false, max: 3, onnotice: () => {} });
  try {
    for (let i = 0; i < out.length; i += 200) {
      const chunk = out.slice(i, i + 200).map((o) => ({ ...o, payload: sql.json(o.payload as any) }));
      await sql`
        insert into opportunities ${sql(chunk as any)}
        on conflict (id) do update set
          label = excluded.label,
          payload = excluded.payload,
          eligible = excluded.eligible,
          ineligible_reason = excluded.ineligible_reason,
          updated_at = now()
      `;
    }
    const summary = await sql<{ category: string; n: number; eligible: number }[]>`
      select category, count(*)::int as n, count(*) filter (where eligible)::int as eligible
      from opportunities group by category order by category
    `;
    console.log(`\n  PERSISTED to Supabase`);
    for (const s of summary) console.log(`    ${s.category.padEnd(13)} ${String(s.n).padStart(4)} rows, ${s.eligible} eligible`);
  } catch (e: any) {
    console.error(`\n  persist failed: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 6 });
  }
}
console.log("");
