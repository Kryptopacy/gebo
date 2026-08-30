/**
 * The four GEBO-operated reference agents.
 *
 * WHY THEY EXIST. Three of the four judged categories had no callable agent at
 * all - the measured state of the chain. These are thin readers over the same
 * verified libraries the marketplace indexes with, so every category has one
 * demonstrably hireable implementation and the advantage harness can compare
 * like against like.
 *
 * GRADER IS NEVER SOLVER. All four are ours: excluded from ranking everywhere,
 * marked as ours on their cards, and any track record they earn is graded by
 * APEX's EvaluatorRouter rather than by us.
 *
 * READS ONLY. None holds keys or moves funds. Their entire risk surface is a
 * public RPC call, which /authority states plainly.
 */
import postgres from "postgres";
import {
  bestSupplyApr,
  type SupplyApr,
} from "./venus.ts";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";

export type PersonaId = "yield" | "grid" | "rebalance";

export type PersonaAnswer = {
  text: string;
  data: Record<string, unknown>;
};

let client: ReturnType<typeof postgres> | null = null;
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = postgres(url, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 8, onnotice: () => {} });
  }
  return client;
}

const slot0Abi = parseAbi([
  "function slot0() view returns (uint160, int24, uint16, uint16, uint8, uint8, bool)",
]);

/**
 * Deepest eligible V3 pool for a category, straight from our own index.
 *
 * Orders by depthUsd - marginal in-range liquidity priced in USD - which the
 * opportunities cron computes from the pool's own liquidity and sqrtPriceX96.
 * It previously ordered by a tvlUsd field no writer ever produced, so every
 * "deepest" pick was an arbitrary tie-break; the grid persona once named a
 * 1%-fee pool with 2000x less depth than the 0.01% tier on the same pair.
 */
async function deepestPool(category: string): Promise<{ address: string; label: string; feePct: number | null } | null> {
  const sql = db();
  if (!sql) return null;
  const rows = await sql<{ ref: string; label: string; fee_pct: number | null }[]>`
    select ref, label, (payload->>'feePct')::numeric as fee_pct
    from opportunities
    where chain_id = 56 and venue = 'pancakeswap-v3' and eligible
      and category = ${category}
    order by coalesce((payload->>'depthUsd')::numeric, 0) desc
    limit 1`;
  const r = rows[0];
  return r ? { address: r.ref, label: r.label, feePct: r.fee_pct == null ? null : Number(r.fee_pct) } : null;
}

function viemClient() {
  return createPublicClient({
    chain: bsc,
    transport: http(process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com", { timeout: 20_000 }),
  });
}

// ── yield ────────────────────────────────────────────────────────────────────

export async function answerYield(): Promise<PersonaAnswer> {
  const b = await bestSupplyApr();
  const toxic = b.excluded.filter((e) => e.aprPct > 50);
  const text = b.best
    ? `Highest Venus supply APR right now is ${b.best.aprPct}% on ${b.best.symbol} ` +
      `(lendable liquidity about $${Math.round(b.best.cashUsd).toLocaleString()}), measured at block ${b.blockNumber}. ` +
      `Top markets: ${b.markets.slice(0, 4).map((m) => `${m.symbol} ${m.aprPct}%`).join(", ")}. ` +
      (toxic.length
        ? `Excluded ${b.excluded.length} market(s) under $50k lendable liquidity, including ${toxic.map((t) => `${t.symbol} (${t.aprPct}% on ~$${Math.round(t.cashUsd)})`).join(", ")} - quoted rates without money behind them are artifacts, not yield. `
        : "") +
      `Simple annualisation at 10,512,000 blocks per year, which understates the true rate on today's faster blocks.`
    : `No Venus market returned a readable supply rate at block ${b.blockNumber}.`;

  return {
    text,
    data: {
      blockNumber: b.blockNumber.toString(),
      best: b.best,
      topMarkets: b.markets.slice(0, 6),
      excludedCount: b.excluded.length,
      excludedOver50Pct: toxic.map((t) => ({ symbol: t.symbol, aprPct: t.aprPct, cashUsd: t.cashUsd })),
      qualifiers: {
        source: "Venus comptroller getAllMarkets, supplyRatePerBlock and getCash per market, oracle prices",
        annualisation: "simple, 10,512,000 blocks/year - Venus core assumes 3s blocks; BNB Chain is faster, so figures understate",
        liquidityFloorUsd: 50_000,
        whyFilter:
          "an APR without lendable liquidity is a broken-rate artifact, not an opportunity",
      },
    },
  };
}

// ── grid / rebalance: shared pool state ─────────────────────────────────────

type PoolState = {
  pool: { address: string; label: string; feePct: number | null };
  tick: number;
  sqrtPriceX96: string;
  blockNumber: bigint;
};

async function readDeepestPoolState(category: string): Promise<PoolState> {
  const pool = await deepestPool(category);
  if (!pool) throw new Error(`no eligible ${category} pool in the opportunities index`);
  const pub = viemClient();
  const [slot0, blockNumber] = await Promise.all([
    pub.readContract({
      address: pool.address as Address,
      abi: slot0Abi,
      functionName: "slot0",
    }) as Promise<readonly [bigint, number, ...unknown[]]>,
    pub.getBlockNumber(),
  ]);
  return {
    pool,
    tick: Number(slot0[1]),
    sqrtPriceX96: String(slot0[0]),
    blockNumber,
  };
}

/**
 * Price bounds implied by ticks, for the grid suggestion. Pure arithmetic over
 * Uniswap-V3 math: price(token1 per token0) = 1.0001^tick.
 */
function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

export async function answerGrid(): Promise<PersonaAnswer> {
  const s = await readDeepestPoolState("grid");
  // A symmetric grid centred on spot: +/-3% price, eight bands each side, so the
  // suggestion is concrete while remaining arithmetic rather than prophecy.
  const spot = tickToPrice(s.tick);
  const loTick = Math.round(Math.log(spot * 0.97) / Math.log(1.0001));
  const hiTick = Math.round(Math.log(spot * 1.03) / Math.log(1.0001));

  const text =
    `For ${s.pool.label} (fee ${s.pool.feePct ?? "?"}%): current tick ${s.tick} at block ${s.blockNumber}. ` +
    `A symmetric grid around spot would span ticks ${loTick} to ${hiTick} (+/-3% price), ` +
    `eight bands per side, buying as price crosses down through each band and selling crossing up. ` +
    `This is market state plus arithmetic, not advice: it does not know your inventory size or risk budget.`;

  return {
    text,
    data: {
      pool: s.pool,
      currentTick: s.tick,
      sqrtPriceX96: s.sqrtPriceX96,
      blockNumber: s.blockNumber.toString(),
      suggestedGrid: { lowerTick: loTick, upperTick: hiTick, bandsPerSide: 8, widthPct: 3 },
      qualifiers: {
        source: "PancakeSwap V3 slot0 via our live opportunity index",
        basis: "deepest active in-range liquidity (on-chain L at the current tick, priced in USD), not TVL",
        limits:
          "reads-only: no inventory, no orders placed, no position taken. Bounds are symmetric-arithmetic, not optimised",
      },
    },
  };
}

export async function answerRebalance(): Promise<PersonaAnswer> {
  const s = await readDeepestPoolState("rebalancing");
  const spot = tickToPrice(s.tick);
  // Concentrated-LP convention: centre a range on spot, half-width 10% of price.
  const loTick = Math.round(Math.log(spot * 0.9) / Math.log(1.0001));
  const hiTick = Math.round(Math.log(spot * 1.1) / Math.log(1.0001));

  const text =
    `For ${s.pool.label}: price sits at tick ${s.tick} (block ${s.blockNumber}). ` +
    `A range centred here spanning ticks ${loTick} to ${hiTick} (+/-10% price) captures the current trading band. ` +
    `If your position's range no longer contains this tick, its capital is one-sided and earning fees on one asset only - ` +
    `that is the condition a rebalance fixes. Per-position checks need your position token ID, which this reads-only agent does not hold.`;

  return {
    text,
    data: {
      pool: s.pool,
      currentTick: s.tick,
      sqrtPriceX96: s.sqrtPriceX96,
      blockNumber: s.blockNumber.toString(),
      suggestedRange: { lowerTick: loTick, upperTick: hiTick, widthPct: 10 },
      qualifiers: {
        source: "PancakeSwap V3 slot0 via our live opportunity index",
        basis: "deepest active in-range liquidity (on-chain L at the current tick, priced in USD), not TVL",
        limits:
          "reads-only: cannot see your LP NFT or MasterChefV3 stake, so 'needs rebalancing' is stated as the condition, not diagnosed per position",
      },
    },
  };
}
