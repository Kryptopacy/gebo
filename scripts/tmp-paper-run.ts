/**
 * Manual paper-run trigger: identical loop to the gebo-paper cron
 * (app/api/cron/paper/route.ts) - reads Venus market state over public RPC,
 * then recordPaperCycle scores the previous run's unscored decisions against
 * the fresh state and records the new run. Exists so a second run can be
 * forced before judging without waiting for the 03:13 UTC schedule; the cron
 * stays the production path.
 *
 * Run: npx tsx scripts/tmp-paper-run.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { createPublicClient, http, fallback, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { recordPaperCycle } from "../src/lib/paper.ts";

const VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;

const comptrollerAbi = parseAbi([
  "function getAllMarkets() view returns (address[])",
]);
const vTokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
]);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 3, connect_timeout: 15, onnotice: () => {} });

async function main() {
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
  console.log("block:", head.toString());

  const vTokens = (await client.readContract({
    address: VENUS_COMPTROLLER, abi: comptrollerAbi, functionName: "getAllMarkets",
  }).catch(() => [])) as readonly Address[];
  if (!vTokens.length) {
    console.error("no Venus markets readable");
    process.exit(1);
  }
  console.log("Venus markets:", vTokens.length);

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
    if (!symbol || totalBorrows == null || cash == null) continue;
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
  console.log("readable markets:", markets.length);

  const summary = await recordPaperCycle(sql, markets);
  console.log(
    `run #${summary.runId}: ${summary.decisions} decisions recorded;` +
    ` scored ${summary.scored} previous decisions (${summary.correct} correct)`
  );

  const rows = await sql`
    select id, decisions_n, scored_n, correct_n, started_at::text
    from paper_runs order by id desc limit 5`;
  console.log("recent runs:");
  for (const r of rows) {
    console.log(`  #${r.id}: ${r.decisions_n} decisions, scored=${r.scored_n}, correct=${r.correct_n}, ${r.started_at.slice(0, 16)}`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end({ timeout: 3 }).catch(() => {});
  process.exit(1);
});
