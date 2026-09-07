/**
 * Scheduled ERC-8004 reputation producer (spec: writeback:erc8004, 6h batch).
 *
 * Until 2026-09-07 the write-back was a hand-run script: 7 writes total, each
 * a proof, none a producer. The strategy doc is explicit that being a
 * reputation PRODUCER is the moat ("a number in 8004scan's Postgres is
 * theirs; a number in the Reputation Registry is the ecosystem's"), and a
 * moat that requires someone remembering to run a script is not one. This
 * module is the script's logic, parameterised so the cron route and the CLI
 * run identical code.
 *
 * The gates travel with the logic, not with the caller: publishable()
 * (20+ probes, 1+ day window, population failure under 50%), the
 * already-written skip (a second uptime write inflates the on-chain count -
 * agent #46192 was double-published once), and the per-metric keying.
 *
 * IRREVERSIBLE: on-chain feedback pointers cannot be deleted. A wrong
 * negative permanently defames a live agent, which is why the population
 * veto exists - if most endpoints failed together, the fault is ours.
 */
import postgres from "postgres";
import {
  createPublicClient, createWalletClient, http, fallback, keccak256, toBytes,
  formatEther, type Hex,
} from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  REPUTATION_REGISTRY, reputationAbi, percentMetric, buildFeedbackFile, toDataUri, publishable,
} from "./reputation.ts";

export type WriteBackSummary = {
  ok: boolean;
  candidates: number;
  published: number;
  skipped: number;
  populationFailureRate: number;
  /** Set when the run refused for a config reason rather than failing. */
  skippedReason: string | null;
  error: string | null;
};

export async function runReputationWriteBack(opts: {
  sql: ReturnType<typeof postgres>;
  publish: boolean;
  limit: number;
  windowDays: number;
  /** Hex private key of the writer. Required when publish; never the owner of a listed agent (self-feedback is contract-blocked). */
  writerKey: string | null;
  /** Receipt wait bound. The cron route must stay inside its maxDuration. */
  receiptTimeoutMs?: number;
  log?: (line: string) => void;
}): Promise<WriteBackSummary> {
  const { sql, publish, limit, windowDays, writerKey, log = () => {} } = opts;
  const receiptTimeoutMs = opts.receiptTimeoutMs ?? 180_000;
  const summary: WriteBackSummary = {
    ok: true, candidates: 0, published: 0, skipped: 0,
    populationFailureRate: 1, skippedReason: null, error: null,
  };

  /**
   * Population failure rate over the same window as the per-agent figures.
   * Computed first, because it can veto every write.
   */
  const [pop] = await sql<{ probes: number; ok: number }[]>`
    select coalesce(sum(probes), 0)::int as probes, coalesce(sum(ok_count), 0)::int as ok
    from probe_daily where day > current_date - (${windowDays} * interval '1 day')`;
  summary.populationFailureRate = pop && pop.probes > 0 ? 1 - pop.ok / pop.probes : 1;

  const rows = await sql<{
    token_id: string; name: string | null; url: string | null;
    probes: number; ok: number; days: number;
  }[]>`
    select a.token_id::text as token_id, a.name, e.url,
           sum(d.probes)::int as probes,
           sum(d.ok_count)::int as ok,
           count(distinct d.day)::int as days
    from probe_daily d
    join agent_endpoints e on e.id = d.endpoint_id
    join agents a on a.chain_id = e.chain_id and a.token_id = e.token_id
    where a.chain_id = 56
      and d.day > current_date - (${windowDays} * interval '1 day')
    group by a.token_id, a.name, e.url
    having sum(d.probes) >= 20
    order by sum(d.probes) desc
    limit ${limit}
  `;
  summary.candidates = rows.length;

  const alreadyWritten = new Set(
    (await sql<{ key: string }[]>`
      select token_id::text || ':' || tag1 as key
      from reputation_writes where chain_id = 56
    `).map((r) => r.key),
  );

  if (publish && !writerKey) {
    summary.skippedReason = "REPUTATION_WRITER_PRIVATE_KEY unset; refusing to publish";
    log(`SKIP: ${summary.skippedReason}`);
    return summary;
  }

  const transport = fallback(
    [process.env.BSC_MAINNET_RPC, "https://bsc-dataseed1.bnbchain.org", "https://binance.llamarpc.com"]
      .filter(Boolean)
      .map((u) => http(u as string, { timeout: 30_000, retryCount: 2 })),
  );
  const pub = createPublicClient({ chain: bsc, transport });
  const account = writerKey ? privateKeyToAccount(writerKey as Hex) : null;

  if (publish && account) {
    const bal = await pub.getBalance({ address: account.address });
    log(`writer ${account.address}  ${Number(formatEther(bal)).toFixed(8)} BNB`);
    if (bal === 0n) {
      summary.skippedReason = "writer has no gas; refusing to half-run";
      log(`SKIP: ${summary.skippedReason}`);
      return summary;
    }
  }

  const wallet = account ? createWalletClient({ account, chain: bsc, transport }) : null;

  for (const r of rows) {
    const uptimePct = r.probes > 0 ? (r.ok / r.probes) * 100 : 0;
    if (alreadyWritten.has(`${r.token_id}:uptime`)) {
      log(`#${r.token_id} ${(r.name ?? "").slice(0, 28)} SKIP: uptime already published`);
      summary.skipped++;
      continue;
    }
    const gate = publishable({
      probes: r.probes, windowDays: r.days,
      populationFailureRate: summary.populationFailureRate,
    });
    const metric = percentMetric("uptime", uptimePct);
    log(`#${r.token_id} ${(r.name ?? "").slice(0, 28)} ${metric.human}  ${r.ok}/${r.probes} over ${r.days}d`);

    if (!gate.ok) {
      log(`  SKIP: ${gate.reason}`);
      summary.skipped++;
      continue;
    }

    const file = buildFeedbackFile({
      chainId: 56,
      agentId: r.token_id,
      metric,
      probes: r.probes,
      windowDays: r.days,
      endpoint: r.url ?? null,
      writer: account?.address ?? "0x0000000000000000000000000000000000000000",
      tag2: `${r.days}d`,
    });
    const json = JSON.stringify(file);
    const feedbackURI = toDataUri(file);
    const feedbackHash = keccak256(toBytes(json));

    if (!publish || !wallet) {
      log(`  would publish: tag1=${metric.tag1} value=${metric.value} dec=${metric.valueDecimals}`);
      continue;
    }

    try {
      const hash = await wallet.writeContract({
        address: REPUTATION_REGISTRY[56],
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
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs });
      log(`  ${rc.status}  gas ${rc.gasUsed.toLocaleString()}  https://bscscan.com/tx/${hash}`);
      if (rc.status !== "success") { summary.skipped++; continue; }

      await sql`
        insert into reputation_writes ${sql({
          chain_id: 56,
          token_id: r.token_id,
          tag1: metric.tag1,
          value: Number(metric.value),
          value_decimals: metric.valueDecimals,
          feedback_uri: feedbackURI.slice(0, 4000),
          tx_hash: hash,
        } as any)}
      `;
      summary.published++;
    } catch (e: any) {
      log(`  FAILED: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 130)}`);
      summary.skipped++;
    }
  }

  return summary;
}
