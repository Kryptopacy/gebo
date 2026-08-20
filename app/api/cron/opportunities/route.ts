/**
 * Opportunity surface refresh.
 *
 * Re-reads PancakeSwap V3 pool state and Venus market rates from chain and
 * upserts the opportunity rows. Pool ticks and lending rates move continuously,
 * so a stale surface is a wrong surface — and "real-time, accurate data" is the
 * criterion this exists to satisfy.
 *
 * Kept inside the serverless budget by reading a fixed pair set via multicall
 * rather than enumerating the factory. Full discovery belongs in the scheduled
 * long job, not a request handler.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { createPublicClient, http, fallback, parseAbi, type Address, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PCS_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as const;
const VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;
/** Venus core annualises per-block rates assuming 3s blocks. BSC is faster, so
 *  this understates the true rate — the caveat travels with the row. */
const VENUS_BLOCKS_PER_YEAR = 10_512_000;

const FEE_TIERS = [100, 500, 2500, 10000] as const;
const TICK_SPACING: Record<number, number> = { 100: 1, 500: 10, 2500: 50, 10000: 200 };

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

const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint32,bool)",
  "function liquidity() view returns (uint128)",
]);
const comptrollerAbi = parseAbi([
  "function getAllMarkets() view returns (address[])",
  "function markets(address) view returns (bool,uint256,bool)",
  "function closeFactorMantissa() view returns (uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
]);
const vTokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
]);

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const startedAt = Date.now();
  const client = createPublicClient({
    chain: bsc,
    transport: fallback(
      [
        process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com",
        "https://binance.llamarpc.com",
        "https://bsc-dataseed1.bnbchain.org",
      ].map((u) => http(u, { timeout: 12_000, retryCount: 1 })),
    ),
    batch: { multicall: { wait: 20, batchSize: 400 } },
  }) as PublicClient;

  const sql = postgres(dbUrl, { prepare: false, max: 3, connect_timeout: 10, onnotice: () => {} });
  const rows: any[] = [];

  try {
    const head = await client.getBlockNumber();

    // ── PancakeSwap V3 ────────────────────────────────────────────────────
    const queries = PAIRS.flatMap(([a, b]) => FEE_TIERS.map((fee) => ({ a, b, fee })));
    const addrs = await client.multicall({
      contracts: queries.map((q) => ({
        address: PCS_FACTORY, abi: factoryAbi, functionName: "getPool" as const,
        args: [TOKENS[q.a]!, TOKENS[q.b]!, q.fee],
      })),
      allowFailure: true,
    });
    const live = queries
      .map((q, i) => ({ ...q, pool: addrs[i]?.status === "success" ? (addrs[i]!.result as Address) : null }))
      .filter((x) => x.pool && x.pool !== "0x0000000000000000000000000000000000000000");

    const [slots, liqs] = await Promise.all([
      client.multicall({ contracts: live.map((p) => ({ address: p.pool!, abi: poolAbi, functionName: "slot0" as const })), allowFailure: true }),
      client.multicall({ contracts: live.map((p) => ({ address: p.pool!, abi: poolAbi, functionName: "liquidity" as const })), allowFailure: true }),
    ]);

    for (let i = 0; i < live.length; i++) {
      const p = live[i]!;
      if (slots[i]?.status !== "success") continue;
      const s = slots[i]!.result as readonly [bigint, number, number, number, number, number, boolean];
      const liquidity = liqs[i]?.status === "success" ? (liqs[i]!.result as bigint) : 0n;
      const hasLiq = liquidity > 0n;
      const label = `${p.a}/${p.b} ${(p.fee / 10_000).toFixed(2)}%`;
      const payload = {
        pool: p.pool, tokenA: p.a, tokenB: p.b,
        feeTier: p.fee, feePct: p.fee / 10_000, tickSpacing: TICK_SPACING[p.fee] ?? null,
        currentTick: s[1], sqrtPriceX96: s[0].toString(), liquidity: liquidity.toString(),
        unlocked: s[6], observationCardinality: s[3],
        masterChefV3: "0x556B9306565093C855AEA9AE92A594704c2Cd59e",
        readAtBlock: head.toString(),
      };
      rows.push({
        id: `rebalancing:56:pancakeswap-v3:${p.pool}`, category: "rebalancing", chain_id: 56,
        venue: "pancakeswap-v3", ref: p.pool!, label, payload: sql.json(payload as any),
        eligible: hasLiq, ineligible_reason: hasLiq ? null : "pool exists but holds no active liquidity",
      });
      const gridOk = hasLiq && p.fee <= 2500;
      rows.push({
        id: `grid:56:pancakeswap-v3:${p.pool}`, category: "grid", chain_id: 56,
        venue: "pancakeswap-v3", ref: p.pool!, label, payload: sql.json(payload as any),
        eligible: gridOk,
        ineligible_reason: gridOk ? null : hasLiq ? "fee tier above 0.25% erodes grid edge" : "no active liquidity",
      });
    }

    // ── Venus ─────────────────────────────────────────────────────────────
    const vTokens = (await client.readContract({
      address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "getAllMarkets",
    }).catch(() => [])) as readonly Address[];

    if (vTokens.length) {
      const [closeFactor, liqIncentive] = await Promise.all([
        client.readContract({ address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "closeFactorMantissa" }).catch(() => 0n),
        client.readContract({ address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "liquidationIncentiveMantissa" }).catch(() => 0n),
      ]);
      const fields = ["symbol", "supplyRatePerBlock", "borrowRatePerBlock", "totalBorrows", "getCash"] as const;
      const reads = await client.multicall({
        contracts: vTokens.flatMap((v) => fields.map((fn) => ({ address: v, abi: vTokenAbi, functionName: fn as any }))),
        allowFailure: true,
      });
      const info = await client.multicall({
        contracts: vTokens.map((v) => ({ address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "markets" as const, args: [v] })),
        allowFailure: true,
      });

      for (let i = 0; i < vTokens.length; i++) {
        const v = vTokens[i]!;
        const base = i * fields.length;
        const get = (k: number) => (reads[base + k]?.status === "success" ? reads[base + k]!.result : null);
        const symbol = (get(0) as string) ?? v.slice(0, 8);
        const supplyRate = (get(1) as bigint) ?? 0n;
        const borrowRate = (get(2) as bigint) ?? 0n;
        const totalBorrows = (get(3) as bigint) ?? 0n;
        const cash = (get(4) as bigint) ?? 0n;
        const mi = info[i]?.status === "success" ? (info[i]!.result as readonly [boolean, bigint, boolean]) : null;
        const collateralFactor = mi ? Number(mi[1]) / 1e18 : null;
        const isListed = mi ? mi[0] : false;
        const supplyApr = (Number(supplyRate) / 1e18) * VENUS_BLOCKS_PER_YEAR * 100;
        const borrowApr = (Number(borrowRate) / 1e18) * VENUS_BLOCKS_PER_YEAR * 100;
        const util = cash + totalBorrows > 0n ? Number(totalBorrows) / Number(cash + totalBorrows) : 0;

        const payload = {
          vToken: v, symbol,
          supplyAprPct: Number(supplyApr.toFixed(4)), borrowAprPct: Number(borrowApr.toFixed(4)),
          rateBasis: "simple annualisation of per-block rate",
          blocksPerYearAssumed: VENUS_BLOCKS_PER_YEAR,
          blocksPerYearCaveat: "Venus core assumes 3s blocks; BSC is faster, so this understates the true rate",
          utilisation: Number(util.toFixed(4)),
          totalBorrows: totalBorrows.toString(), cash: cash.toString(),
          collateralFactor, closeFactor: Number(closeFactor) / 1e18,
          liquidationIncentive: Number(liqIncentive) / 1e18,
          isListed, readAtBlock: head.toString(),
        };
        const hasDepth = cash + totalBorrows > 0n;
        rows.push({
          id: `yield:56:venus:${v}`, category: "yield", chain_id: 56, venue: "venus",
          ref: v, label: `${symbol} supply`, payload: sql.json(payload as any),
          eligible: isListed && hasDepth && supplyApr > 0,
          ineligible_reason: !isListed ? "market not listed" : !hasDepth ? "no liquidity" : supplyApr <= 0 ? "zero supply rate" : null,
        });
        const borrowable = isListed && (collateralFactor ?? 0) > 0;
        rows.push({
          id: `health:56:venus:${v}`, category: "health", chain_id: 56, venue: "venus",
          ref: v, label: `${symbol} collateral`, payload: sql.json(payload as any),
          eligible: borrowable,
          ineligible_reason: borrowable ? null : "cannot be used as collateral — no liquidation risk to manage",
        });
      }
    }

    for (let i = 0; i < rows.length; i += 150) {
      await sql`
        insert into opportunities ${sql(rows.slice(i, i + 150))}
        on conflict (id) do update set
          label = excluded.label, payload = excluded.payload,
          eligible = excluded.eligible, ineligible_reason = excluded.ineligible_reason,
          updated_at = now()
      `;
    }

    return NextResponse.json({
      ok: true, block: head.toString(), pools: live.length,
      markets: vTokens.length, rows: rows.length, ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
