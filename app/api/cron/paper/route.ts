/**
 * Paper-mode cron: runs the reference health agent's real decision loop
 * (reads Venus market state, decides per market), records every decision
 * with its measured inputs, and scores the previous run's decisions
 * against the fresh state. Daily, 03:13 UTC (migration 0036).
 *
 * The loop is read-only: no call targets, no spend caps - the zero-spend
 * scope the spec's paper mode describes, recorded on the run row rather
 * than asserted (src/lib/paper.ts carries the constant).
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { createPublicClient, http, fallback, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { authorizeCron } from "@/lib/cron-auth";
import { recordPaperCycle } from "@/lib/paper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;

const comptrollerAbi = parseAbi([
  "function getAllMarkets() view returns (address[])",
]);
const vTokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
]);

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const startedAt = Date.now();
  const sql = postgres(url, { prepare: false, max: 3, connect_timeout: 10, onnotice: () => {} });

  try {
    const client = createPublicClient({
      chain: bsc,
      transport: fallback(
        [
          process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com",
          "https://bsc-dataseed1.bnbchain.org",
        ].map((u) => http(u, { timeout: 12_000, retryCount: 1 })),
      ),
      batch: { multicall: { wait: 20, batchSize: 400 } },
    });

    const head = await client.getBlockNumber();
    const vTokens = (await client.readContract({
      address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "getAllMarkets",
    }).catch(() => [])) as readonly Address[];
    if (!vTokens.length) {
      return NextResponse.json({ ok: false, error: "no Venus markets readable" }, { status: 503 });
    }

    const fields = ["symbol", "totalBorrows", "getCash"] as const;
    const reads = await client.multicall({
      contracts: vTokens.flatMap((v) => fields.map((fn) => ({ address: v, abi: vTokenAbi, functionName: fn as any }))),
      allowFailure: true,
    });

    const markets: { subjectId: string; utilisation: number; cash: string; totalBorrows: string; readAtBlock: string }[] = [];
    for (let i = 0; i < vTokens.length; i++) {
      const base = i * fields.length;
      const get = (k: number) => (reads[base + k]?.status === "success" ? reads[base + k]!.result : null);
      const symbol = (get(0) as string) ?? null;
      const totalBorrows = (get(1) as bigint) ?? null;
      const cash = (get(2) as bigint) ?? null;
      if (!symbol || totalBorrows == null || cash == null) continue; // unmeasured market: skipped, not zeroed
      const total = cash + totalBorrows;
      if (total <= 0n) continue;
      markets.push({
        subjectId: symbol,
        utilisation: Number(totalBorrows) / Number(total),
        cash: cash.toString(),
        totalBorrows: totalBorrows.toString(),
        readAtBlock: head.toString(),
      });
    }

    const summary = await recordPaperCycle(sql, markets);

    return NextResponse.json({
      ok: true,
      run: summary.runId,
      decisions: summary.decisions,
      scoredPrevious: summary.scored,
      correctPrevious: summary.correct,
      block: head.toString(),
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
