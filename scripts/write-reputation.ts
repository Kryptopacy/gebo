/**
 * Publish measured liveness to the ERC-8004 Reputation Registry.
 *
 * This is the claim that distinguishes the project: most indexes CONSUME reputation
 * data, and almost none produce any. What gets written here is not an opinion but a
 * count - uptime over a stated window, with the probe count attached.
 *
 * IRREVERSIBLE, SO THE GATE COMES FIRST. The spec notes on-chain feedback pointers
 * cannot be deleted, so a wrong negative permanently misrepresents a working agent.
 * publishable() in src/lib/reputation.ts refuses under 20 probes, under a day of
 * history, or when more than half the population failed in the same window - because
 * tens of thousands of agents do not break simultaneously, but our own egress does.
 *
 * WHAT IS NOT DONE HERE. No aggregate score, and no unfiltered read: getSummary is
 * only ever called with a non-empty clientAddresses filter, since an unfiltered
 * aggregate is Sybil-farmable and the standard says so. Competitors rendering a global
 * score are violating the spec they cite.
 *
 * Run: npx tsx scripts/write-reputation.ts              (dry run, writes nothing)
 *      npx tsx scripts/write-reputation.ts --publish    (sends transactions)
 *      npx tsx scripts/write-reputation.ts --publish --limit 3
 */
import "dotenv/config";
import postgres from "postgres";
import { createPublicClient, createWalletClient, http, fallback, keccak256, toBytes, formatEther, type Hex } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  REPUTATION_REGISTRY, reputationAbi, percentMetric, buildFeedbackFile, toDataUri, publishable,
} from "../src/lib/reputation.ts";

const PUBLISH = process.argv.includes("--publish");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1] ?? 5)) : 5;
})();
const CHAIN_ID = 56;
const WINDOW_DAYS = 7;

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, onnotice: () => {} });

const transport = fallback(
  [process.env.BSC_MAINNET_RPC, "https://bsc-dataseed1.bnbchain.org", "https://binance.llamarpc.com"]
    .filter(Boolean)
    .map((u) => http(u as string, { timeout: 30_000, retryCount: 2 })),
);
const pub = createPublicClient({ chain: bsc, transport });

/**
 * Population failure rate over the same window as the per-agent figures.
 *
 * Computed first, because it can veto every write. If most endpoints failed together
 * the cause is far more likely to be us than them.
 */
const [pop] = await sql<{ probes: number; ok: number }[]>`
  select coalesce(sum(probes), 0)::int as probes, coalesce(sum(ok_count), 0)::int as ok
  from probe_daily where day > current_date - (${WINDOW_DAYS} * interval '1 day')`;
const populationFailureRate = pop && pop.probes > 0 ? 1 - pop.ok / pop.probes : 1;

/**
 * Candidates: enough observations to say anything, and a real agent behind them.
 * Uptime is ok_count over probes, both counted per endpoint-day and summed.
 */
const rows = await sql<{
  token_id: string; name: string | null; url: string | null;
  probes: number; ok: number; days: number; p50: number | null;
}[]>`
  select a.token_id::text as token_id, a.name, e.url,
         sum(d.probes)::int as probes,
         sum(d.ok_count)::int as ok,
         count(distinct d.day)::int as days,
         percentile_disc(0.5) within group (order by d.p50_ms) as p50
  from probe_daily d
  join agent_endpoints e on e.id = d.endpoint_id
  join agents a on a.chain_id = e.chain_id and a.token_id = e.token_id
  where a.chain_id = ${CHAIN_ID}
    and d.day > current_date - (${WINDOW_DAYS} * interval '1 day')
  group by a.token_id, a.name, e.url
  having sum(d.probes) >= 20
  order by sum(d.probes) desc
  limit ${LIMIT}
`;

/**
 * Already published, and therefore skipped.
 *
 * A write here is permanent, and a re-run had no memory of the previous one: agent
 * #46192 was published twice within a minute, and getSummary now reports count=2 for
 * a single measurement. That inflates our own observation count on chain, which is
 * exactly the kind of manufactured volume this project criticises elsewhere.
 *
 * Keyed on the metric as well as the agent, so a genuinely different measurement -
 * responseTime rather than uptime - is still publishable later.
 */
const alreadyWritten = new Set(
  (
    await sql<{ key: string }[]>`
      select token_id::text || ':' || tag1 as key
      from reputation_writes where chain_id = ${CHAIN_ID}
    `
  ).map((r) => r.key),
);

console.log(`\n  ERC-8004 REPUTATION WRITE-BACK`);
console.log(`  registry ${REPUTATION_REGISTRY[CHAIN_ID]}`);
console.log(`  window   ${WINDOW_DAYS} days`);
console.log(`  mode     ${PUBLISH ? "PUBLISH (irreversible)" : "dry run"}`);
console.log(`  population failure rate ${(populationFailureRate * 100).toFixed(1)}%\n`);

const account = PUBLISH
  ? privateKeyToAccount((process.env.REPUTATION_WRITER_PRIVATE_KEY ?? "") as Hex)
  : null;
if (PUBLISH) {
  if (!process.env.REPUTATION_WRITER_PRIVATE_KEY) {
    console.error("  REPUTATION_WRITER_PRIVATE_KEY unset; refusing to publish.\n");
    await sql.end();
    process.exit(1);
  }
  const bal = await pub.getBalance({ address: account!.address });
  console.log(`  writer   ${account!.address}  ${Number(formatEther(bal)).toFixed(8)} BNB`);
  if (bal === 0n) {
    console.error("  no gas; refusing to start rather than half-run.\n");
    await sql.end();
    process.exit(1);
  }
}

const wallet = account ? createWalletClient({ account, chain: bsc, transport }) : null;
let published = 0;
let skipped = 0;

for (const r of rows) {
  const uptimePct = r.probes > 0 ? (r.ok / r.probes) * 100 : 0;
  if (alreadyWritten.has(`${r.token_id}:uptime`)) {
    console.log(`  #${r.token_id.padEnd(8)} ${(r.name ?? "").slice(0, 28).padEnd(29)} SKIP: uptime already published; a second write would inflate the on-chain count`);
    skipped++;
    continue;
  }
  const gate = publishable({ probes: r.probes, windowDays: r.days, populationFailureRate });
  const metric = percentMetric("uptime", uptimePct);

  console.log(`  #${r.token_id.padEnd(8)} ${(r.name ?? "").slice(0, 28).padEnd(29)} ${metric.human.padStart(7)}  ${r.ok}/${r.probes} over ${r.days}d`);

  if (!gate.ok) {
    console.log(`             SKIP: ${gate.reason}`);
    skipped++;
    continue;
  }

  const file = buildFeedbackFile({
    chainId: CHAIN_ID,
    agentId: r.token_id,
    metric,
    probes: r.probes,
    windowDays: r.days,
    endpoint: r.url ?? null,
    // The writer identity travels in the file so a reader knows who measured this.
    writer: account?.address ?? "0x0000000000000000000000000000000000000000",
    tag2: `${r.days}d`,
  });
  const json = JSON.stringify(file);
  const feedbackURI = toDataUri(file);
  const feedbackHash = keccak256(toBytes(json));

  if (!PUBLISH) {
    console.log(`             would publish: tag1=${metric.tag1} value=${metric.value} dec=${metric.valueDecimals}`);
    console.log(`             hash ${feedbackHash.slice(0, 18)}  uri ${feedbackURI.length} bytes`);
    continue;
  }

  try {
    const hash = await wallet!.writeContract({
      address: REPUTATION_REGISTRY[CHAIN_ID],
      abi: reputationAbi,
      functionName: "giveFeedback",
      args: [
        BigInt(r.token_id),
        metric.value,
        metric.valueDecimals,
        metric.tag1,
        `${r.days}d`,
        r.url ?? "",
        feedbackURI,
        feedbackHash,
      ],
    });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    console.log(`             ${rc.status}  gas ${rc.gasUsed.toLocaleString()}  https://bscscan.com/tx/${hash}`);
    if (rc.status !== "success") { skipped++; continue; }

    await sql`
      insert into reputation_writes ${sql({
        chain_id: CHAIN_ID,
        token_id: r.token_id,
        tag1: metric.tag1,
        value: Number(metric.value),
        value_decimals: metric.valueDecimals,
        feedback_uri: feedbackURI.slice(0, 4000),
        tx_hash: hash,
      } as any)}
    `;
    published++;
  } catch (e: any) {
    console.log(`             FAILED: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 130)}`);
    skipped++;
  }
}

console.log(`\n  ${PUBLISH ? `${published} published, ${skipped} skipped.` : "Dry run: nothing written."}`);
if (!rows.length) console.log(`  No agent has 20+ probes in the window yet.`);
console.log("");

await sql.end({ timeout: 5 });
