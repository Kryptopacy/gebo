/**
 * Dry-run simulation against live BNB Chain state.
 *
 * This is what makes GEBO's "simulate before you authorise" step real rather
 * than illustrative. It costs nothing and needs no funded wallet: PancakeSwap's
 * QuoterV2 is called through eth_call, so it returns the same amountOut, tick
 * movement and gas estimate a real swap would produce at this block.
 *
 * QuoterV2 is deliberately non-view — it reverts internally and encodes the
 * result in the revert data — so it must be simulated, not read. Using
 * readContract here fails, which is a common integration mistake.
 */
import { createPublicClient, http, fallback, parseAbi, formatUnits, defineChain, type Address, type PublicClient } from "viem";
// Inline chain definition, not the "viem/chains" barrel: viem 2.55 has no
// per-chain subpath export, and the barrel evaluates ~500 chain modules
// (measured 15s+ per fresh dev worker on this machine - the cause of the hire
// page "navigation keeps timing out"). viem's own bsc is equivalent EXCEPT it
// also carries the multicall3 contract address, which the multicall() calls
// below require: without it every simulation died with
// 'Chain "BNB Smart Chain" does not support contract "multicall3"' - the
// "Simulation failed" seen on every hire page. Multicall3's canonical address
// is identical on every chain; on BSC it was deployed at block 17,422,723.
const bsc = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-rpc.publicnode.com"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://bscscan.com" } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 17_422_723 },
  },
});
import { TOKENS } from "./session-scope.ts";

const QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as const;
const PCS_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as const;
const VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;
const VENUS_BLOCKS_PER_YEAR = 10_512_000;

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16,uint16,uint16,uint32,bool)",
  "function liquidity() view returns (uint128)",
]);
const vTokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function underlying() view returns (address)",
]);
const comptrollerAbi = parseAbi(["function getAllMarkets() view returns (address[])"]);

function client(): PublicClient {
  return createPublicClient({
    chain: bsc,
    transport: fallback(
      [
        process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com",
        "https://binance.llamarpc.com",
        "https://bsc-dataseed1.bnbchain.org",
      ].map((u) => http(u, { timeout: 12_000, retryCount: 1 })),
    ),
    batch: { multicall: { wait: 20, batchSize: 200 } },
  }) as PublicClient;
}

export type SimulatedCall = {
  contract: string;
  contractAddress: Address;
  fn: string;
  summary: string;
  detail: string[];
};

export type SimulationResult = {
  ok: boolean;
  block: string | null;
  /** Human-readable statement of what would happen. */
  headline: string;
  calls: SimulatedCall[];
  deltas: { token: string; direction: "out" | "in"; amount: string }[];
  gasEstimate: string | null;
  notes: string[];
  error: string | null;
  simulatedAt: string;
};

/** price of token0 in token1 terms, from sqrtPriceX96 */
function priceFromSqrt(sqrtPriceX96: bigint, d0: number, d1: number): number {
  const q96 = 2 ** 96;
  const s = Number(sqrtPriceX96) / q96;
  return s * s * 10 ** (d0 - d1);
}

/**
 * Simulate a swap of `amountIn` of `tokenIn` for `tokenOut`, quoting whichever
 * fee tier actually holds liquidity.
 */
export async function simulateSwap(
  tokenInSymbol: string,
  tokenOutSymbol: string,
  humanAmountIn: string,
): Promise<SimulationResult> {
  const at = new Date().toISOString();
  const tin = TOKENS[tokenInSymbol];
  const tout = TOKENS[tokenOutSymbol];
  if (!tin || !tout) {
    return { ok: false, block: null, headline: "Unknown token", calls: [], deltas: [], gasEstimate: null, notes: [], error: `unknown token ${tokenInSymbol}/${tokenOutSymbol}`, simulatedAt: at };
  }

  const amountIn = BigInt(Math.round(Number(humanAmountIn) * 10 ** Math.min(tin.decimals, 6))) * 10n ** BigInt(tin.decimals - Math.min(tin.decimals, 6));
  const pub = client();

  try {
    const block = await pub.getBlockNumber();

    // Find the fee tier with liquidity rather than assuming 0.05%.
    const tiers = [100, 500, 2500, 10000] as const;
    const pools = await pub.multicall({
      contracts: tiers.map((fee) => ({
        address: PCS_FACTORY, abi: factoryAbi, functionName: "getPool" as const,
        args: [tin.address, tout.address, fee],
      })),
      allowFailure: true,
    });
    const candidates = tiers
      .map((fee, i) => ({ fee, pool: pools[i]?.status === "success" ? (pools[i]!.result as Address) : null }))
      .filter((c) => c.pool && c.pool !== "0x0000000000000000000000000000000000000000");

    if (!candidates.length) {
      return { ok: false, block: block.toString(), headline: "No pool exists for this pair", calls: [], deltas: [], gasEstimate: null, notes: [], error: "no pool", simulatedAt: at };
    }

    const liq = await pub.multicall({
      contracts: candidates.map((c) => ({ address: c.pool!, abi: poolAbi, functionName: "liquidity" as const })),
      allowFailure: true,
    });
    const best = candidates
      .map((c, i) => ({ ...c, liquidity: liq[i]?.status === "success" ? (liq[i]!.result as bigint) : 0n }))
      .sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1))[0]!;

    if (best.liquidity === 0n) {
      return { ok: false, block: block.toString(), headline: "Pool exists but holds no liquidity", calls: [], deltas: [], gasEstimate: null, notes: [], error: "no liquidity", simulatedAt: at };
    }

    // QuoterV2 reverts by design and encodes the answer in the revert payload,
    // so this must be simulated rather than read.
    const sim = await pub.simulateContract({
      address: QUOTER_V2,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn: tin.address, tokenOut: tout.address,
        amountIn, fee: best.fee, sqrtPriceLimitX96: 0n,
      }],
    });

    const [amountOut, sqrtAfter, ticksCrossed, gasEstimate] = sim.result as readonly [bigint, bigint, number, bigint];

    const slot = await pub.readContract({ address: best.pool!, abi: poolAbi, functionName: "slot0" });
    const sqrtBefore = (slot as readonly [bigint, number, number, number, number, number, boolean])[0];

    const isZeroForOne = tin.address.toLowerCase() < tout.address.toLowerCase();
    const pBefore = priceFromSqrt(sqrtBefore, isZeroForOne ? tin.decimals : tout.decimals, isZeroForOne ? tout.decimals : tin.decimals);
    const pAfter = priceFromSqrt(sqrtAfter, isZeroForOne ? tin.decimals : tout.decimals, isZeroForOne ? tout.decimals : tin.decimals);
    const impactPct = pBefore > 0 ? Math.abs((pAfter - pBefore) / pBefore) * 100 : 0;

    const outHuman = formatUnits(amountOut, tout.decimals);
    const effRate = Number(outHuman) / Number(humanAmountIn);

    const notes = [
      `Quoted from the pool with the deepest liquidity (${(best.fee / 10_000).toFixed(2)}% fee tier).`,
      `Crosses ${ticksCrossed} initialised tick${ticksCrossed === 1 ? "" : "s"}.`,
      `Price impact approximately ${impactPct < 0.01 ? "<0.01" : impactPct.toFixed(3)}%.`,
      "Quoted at the current block. A real execution settles at a later block and may differ.",
    ];
    if (impactPct > 1) notes.push("Impact above 1% — this size is large relative to the pool.");

    return {
      ok: true,
      block: block.toString(),
      headline: `${humanAmountIn} ${tin.symbol} would return about ${Number(outHuman).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tout.symbol}`,
      calls: [{
        contract: "PancakeSwap SmartRouter",
        contractAddress: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
        fn: "exactInputSingle",
        summary: `Swap ${humanAmountIn} ${tin.symbol} → ${tout.symbol} via the ${(best.fee / 10_000).toFixed(2)}% pool`,
        detail: [
          `pool ${best.pool}`,
          `effective rate 1 ${tin.symbol} = ${effRate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tout.symbol}`,
          `recipient must be your own wallet`,
        ],
      }],
      deltas: [
        { token: tin.symbol, direction: "out", amount: `${humanAmountIn} ${tin.symbol}` },
        { token: tout.symbol, direction: "in", amount: `${Number(outHuman).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tout.symbol}` },
      ],
      gasEstimate: gasEstimate.toString(),
      notes,
      error: null,
      simulatedAt: at,
    };
  } catch (err: any) {
    return {
      ok: false, block: null, headline: "Simulation failed", calls: [], deltas: [],
      gasEstimate: null, notes: [],
      error: String(err?.shortMessage ?? err?.message ?? err).slice(0, 200),
      simulatedAt: at,
    };
  }
}

/**
 * Project what supplying to Venus would earn, from the live per-block rate.
 * States its own annualisation assumption rather than presenting a bare APY.
 */
export async function simulateVenusSupply(symbol: string, humanAmount: string): Promise<SimulationResult> {
  const at = new Date().toISOString();
  const pub = client();
  try {
    const block = await pub.getBlockNumber();
    const markets = (await pub.readContract({
      address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "getAllMarkets",
    })) as readonly Address[];

    const syms = await pub.multicall({
      contracts: markets.map((m) => ({ address: m, abi: vTokenAbi, functionName: "symbol" as const })),
      allowFailure: true,
    });
    const idx = syms.findIndex((s) => s.status === "success" && String(s.result).toLowerCase() === `v${symbol}`.toLowerCase());
    if (idx < 0) {
      return { ok: false, block: block.toString(), headline: `Venus has no market for ${symbol}`, calls: [], deltas: [], gasEstimate: null, notes: [], error: "no market", simulatedAt: at };
    }

    const vToken = markets[idx]!;
    const rate = (await pub.readContract({ address: vToken, abi: vTokenAbi, functionName: "supplyRatePerBlock" })) as bigint;
    const aprPct = (Number(rate) / 1e18) * VENUS_BLOCKS_PER_YEAR * 100;
    const yearly = (Number(humanAmount) * aprPct) / 100;

    return {
      ok: true,
      block: block.toString(),
      headline: `${humanAmount} ${symbol} supplied to Venus earns about ${yearly.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol} a year at the current rate`,
      calls: [{
        contract: "Venus vToken",
        contractAddress: vToken,
        fn: "mint",
        summary: `Supply ${humanAmount} ${symbol} to the Venus ${symbol} market`,
        detail: [`market ${vToken}`, `supply APR ${aprPct.toFixed(3)}%`],
      }],
      deltas: [
        { token: symbol, direction: "out", amount: `${humanAmount} ${symbol}` },
        { token: `v${symbol}`, direction: "in", amount: `receipt tokens` },
      ],
      gasEstimate: null,
      notes: [
        `Simple annualisation of the per-block rate, assuming ${VENUS_BLOCKS_PER_YEAR.toLocaleString()} blocks per year.`,
        "Venus core assumes three-second blocks and BNB Chain is faster, so this understates the true rate.",
        "The rate floats with utilisation and is not a commitment.",
      ],
      error: null,
      simulatedAt: at,
    };
  } catch (err: any) {
    return {
      ok: false, block: null, headline: "Simulation failed", calls: [], deltas: [],
      gasEstimate: null, notes: [],
      error: String(err?.shortMessage ?? err?.message ?? err).slice(0, 200),
      simulatedAt: at,
    };
  }
}

/** Pick a representative dry run for the agent's category. */
export async function simulateForCategory(category: string | null): Promise<SimulationResult> {
  switch (category) {
    case "yield":
      return simulateVenusSupply("USDT", "1000");
    case "health":
      return simulateVenusSupply("USDT", "500");
    case "rebalancing":
      return simulateSwap("USDT", "WBNB", "250");
    case "grid":
    default:
      return simulateSwap("USDT", "WBNB", "100");
  }
}
