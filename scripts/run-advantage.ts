/**
 * Agent Advantage runs: ask registered agents to do a job, and do it ourselves.
 *
 * The task is one this registry already validates against chain: report the Venus
 * health factor for an address. There is a right answer, checkable to the cent
 * against Venus's own getAccountLiquidity, so an agent's reply can be graded rather
 * than admired.
 *
 * WHY THESE SUBJECTS. The agents asked are the ones actually registered on ERC-8004
 * in the health and rebalancing categories - including the five that advertise a
 * loopback endpoint inside an otherwise valid Agent Card. Asking them is not a gotcha:
 * it is the question a user would ask, sent to the address the registry publishes. If
 * the published address cannot be reached, that IS the finding.
 *
 * WHY NOT OUR OWN AGENT. Comparing our agent against our own library would be
 * circular - the agent is an HTTP wrapper around the same function. It appears here
 * only as a control, so the comparison shows what a reachable implementation of the
 * same task looks like.
 *
 * THE MANUAL ARM IS HONEST ABOUT WHAT IT IS. It runs the same computation the agent
 * would, from chain, and is timed over the reads and arithmetic. It does NOT include
 * the time a person spends discovering that getAssetsIn, getAccountSnapshot, the
 * oracle's 36-minus-decimals scaling and the collateral factors are what you need -
 * which understates the manual cost and therefore understates any agent advantage.
 * Stated rather than quietly enjoyed, and repeated in the UI.
 *
 * Run: npx tsx scripts/run-advantage.ts [--record] [--limit <n>] [--category <slug> ...]
 *
 *   --record            write attested evidence rows (gebo_task) for each run
 *   --limit <n>         how many verified a2a agents to ask (default 4)
 *   --category <slug>   restrict to these categories; repeatable. Defaults to the
 *                       three judged ones the harness was built around. Pass one
 *                       here (or many) to widen coverage to the whole verified
 *                       population - the "same thoroughness for all agents" goal.
 *
 * Without --record the harness is a dry run: it measures, grades and prints, but
 * never writes to the evidence ledger, so it is safe to point at any agent.
 */
import "dotenv/config";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { bsc } from "viem/chains";
import { healthFactorFor, summarise, bestSupplyApr } from "../src/lib/venus.ts";
import { gradeNumericAnswer, parseAgentReply, structuredReplyText, rpcErrorMessage } from "../src/lib/task-grade.ts";

const args = process.argv.slice(2);
const RECORD = args.includes("--record");
const TIMEOUT_MS = 45_000;

/** --limit <n>: how many verified a2a agents to ask (default 4 for a bounded run). */
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  const n = i >= 0 ? Number(args[i + 1]) : 4;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
})();

/** --category <slug> (repeatable). Defaults to the judged categories the harness targets. */
const SCOPE_CATEGORIES = (() => {
  const cats: string[] = [];
  args.forEach((a, i) => {
    if (a === "--category") {
      const nxt = args[i + 1];
      // Only honour a real slug: "--category --other" or "--category" as the
      // last token must not pollute the category filter with a flag or undefined.
      if (nxt && !nxt.startsWith("--")) cats.push(nxt);
    }
  });
  return cats.length ? cats : ["health", "rebalancing", "grid"];
})();

/** Addresses with known, validated Venus state. Chosen for variety of outcome. */
const SUBJECTS: { address: Address; note: string }[] = [
  { address: "0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055", note: "live borrowing position across 4 markets" },
  { address: "0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB", note: "collateral in 5 markets, no debt" },
];

/**
 * THE THREE TASKS.
 *
 * TermiX requires at least three real tasks run both ways, with time, cost and
 * output reported per task, and at least one from a high-stakes category. These
 * are three genuinely different questions rather than one question re-asked:
 *
 *   venus-hf    security. Liquidation risk of a live position - checkable to the
 *               cent against Venus's own getAccountLiquidity.
 *   venus-apr   yield. Where idle capital earns most right now - checkable
 *               against supplyRatePerBlock on every market.
 *   pcs-tick    trading infrastructure. The exact state of the deepest WBNB/USDT
 *               pool - checkable against slot0, and the number a grid or
 *               rebalancing agent must know before placing anything.
 *
 * Each manual arm runs the same computation an agent would, timed over reads and
 * arithmetic only, so it understates - never overstates - agent advantage.
 */
type ManualResult = {
  target: number | null;
  text: string;
  ms: number;
  refKey: string;
  /**
   * Overrides the canned question when the position's state changes what is
   * worth asking - a no-debt account has no ratio, so the harness asks about
   * borrowing power instead of grading an answer to a question it mis-set.
   */
  question?: string;
};

const TASKS: {
  id: string;
  label: string;
  category: string;
  question: (subject?: Address) => string;
  runManual: () => Promise<ManualResult>;
}[] = [
  {
    id: "venus-hf",
    label: "Venus health factor",
    category: "security",
    question: (subject) =>
      `What is the Venus lending health factor for ${subject} on BNB Chain? ` +
      `Report the ratio and whether the position is at risk of liquidation.`,
    runManual: async () => {
      const started = Date.now();
      const subject = SUBJECTS[0]!.address;
      const truth = await healthFactorFor(subject);
      const hasRatio = truth.healthFactor != null;
      const target = hasRatio ? truth.healthFactor! : truth.borrowingPowerUsd;
      return {
        target,
        text: summarise(truth),
        ms: Date.now() - started,
        refKey: subject.slice(2, 10),
        question: hasRatio
          ? `What is the Venus lending health factor for ${subject} on BNB Chain? Report the ratio and whether the position is at risk of liquidation.`
          : `${subject} supplies collateral on Venus but carries no debt right now, so there is no ratio. ` +
            `How much borrowing power, in USD, does that address have? Report the figure.`,
      };
    },
  },
  {
    id: "venus-apr",
    label: "Best Venus supply APR",
    category: "yield",
    question: () =>
      `Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market ` +
      `currently pays suppliers the highest APR, and what is that APR in percent?`,
    runManual: async () => {
      const started = Date.now();
      const best = await bestSupplyApr();
      return {
        target: best.best?.aprPct ?? null,
        text:
          (best.best
            ? `Highest supply APR ${best.best.aprPct}% on ${best.best.symbol} at block ${best.blockNumber}. ` +
              `All markets: ${best.markets.map((m) => `${m.symbol} ${m.aprPct}%`).join(", ")}. ` +
              `Simple annualisation at 10,512,000 blocks/year; understates true rate on today's faster blocks.`
            : `No listed market returned a readable supply rate.`),
        ms: Date.now() - started,
        refKey: "all",
      };
    },
  },
  {
    id: "pcs-tick",
    label: "PancakeSwap V3 pool tick",
    category: "trading-infrastructure",
    question: (subject) =>
      `For the PancakeSwap V3 pool ${subject}: what is the current tick, and what does it imply about which side of the pool is token0 vs token1?`,
    runManual: async () => {
      // The canonical deepest WBNB/USDT pair, read fresh so both arms see the
      // same market seconds apart rather than a cached snapshot.
      const pool = await deepestWbnbUsdtPool();
      if (!pool) throw new Error("no eligible WBNB/USDT pool found in opportunities index");
      const started = Date.now();
      const pub = createPublicClient({
        chain: bsc,
        transport: http(process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com", { timeout: 20_000 }),
      });
      const slot0 = await pub.readContract({
        address: pool.address as Address,
        abi: parseAbi(["function slot0() view returns (uint160, int24, uint16, uint16, uint8, uint8, bool)"]),
        functionName: "slot0",
      }) as readonly [bigint, number, ...unknown[]];
      const tick = Number(slot0[1]);
      return {
        target: tick,
        text:
          `Pool ${pool.label} (${pool.address}) sits at tick ${tick}. ` +
          `Price of token1 in token0 is 1.0001^tick, so the sign of the tick says which side holds the active capital.`,
        ms: Date.now() - started,
        refKey: pool.address.slice(2, 10),
        // The question must name the pool the manual arm just read. Without
        // this override the fallback `task.question()` runs with no subject
        // and the recorded ask - the string literally sent to agents - says
        // "the pool undefined", which is how 2026-08-26's rows were recorded.
        question:
          `For the PancakeSwap V3 pool ${pool.label}: what is the current tick, and what does it imply about which side of the pool is token0 vs token1?`,
      };
    },
  },
];

/**
 * Deepest WBNB/USDT pool straight from our own opportunities index.
 *
 * The pair filter is load-bearing: without it the query once returned an
 * arbitrary pool (the old tvlUsd ordering never matched a real field), and the
 * pcs-tick task asked agents about whatever row came first. Depth comes from
 * the cron-computed depthUsd; within one pair it reduces to raw liquidity.
 */
async function deepestWbnbUsdtPool(): Promise<{ address: string; label: string } | null> {
  const rows = await sql<{ ref: string; label: string; payload: unknown }[]>`
    select ref, label, payload
    from opportunities
    where chain_id = 56 and category = 'rebalancing' and venue = 'pancakeswap-v3' and eligible
      and ((payload->>'tokenA' = 'WBNB' and payload->>'tokenB' = 'USDT')
        or (payload->>'tokenA' = 'USDT' and payload->>'tokenB' = 'WBNB'))
    order by coalesce((payload->>'depthUsd')::numeric, (payload->>'liquidity')::numeric, 0) desc
    limit 1`;
  const r = rows[0];
  return r ? { address: r.ref, label: r.label } : null;
}

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, onnotice: () => {} });

/** Registered agents whose declared job covers these questions. */
const agents = await sql<{ token_id: string; name: string | null; category: string | null; url: string; kind: string }[]>`
  select a.token_id::text as token_id, a.name, a.category, e.url, e.kind
  from agents a
  join agent_endpoints e on e.chain_id = a.chain_id and e.token_id = a.token_id
  where a.chain_id = 56
    and a.trust_state = 'VERIFIED'
    and a.category = any(${SCOPE_CATEGORIES})
    and e.kind = 'a2a'
  order by (a.category = 'health') desc, a.token_id desc
  limit ${LIMIT}
`;

/** How much of the verified population we already have evidence for (coverage). */
const coverage = await sql<{ category: string | null; total: number; with_evidence: number }[]>`
  select a.category,
         count(distinct a.token_id)::int                      as total,
         count(distinct case when atn.token_id is not null then a.token_id end)::int as with_evidence
  from agents a
  join agent_endpoints e on e.chain_id = a.chain_id and e.token_id = a.token_id and e.kind = 'a2a'
  left join attestations atn
    on atn.chain_id = a.chain_id and atn.token_id = a.token_id and atn.evidence_kind = 'gebo_task'
  where a.chain_id = 56
    and a.trust_state = 'VERIFIED'
    and a.category = any(${SCOPE_CATEGORIES})
  group by a.category
  order by a.category`;

console.log(`\n  AGENT ADVANTAGE: ${TASKS.length} tasks x ${agents.length} registered agents`);
console.log(`  ${"=".repeat(70)}`);
console.log(`  mode      ${RECORD ? "RECORD" : "dry run"}`);
console.log(`  tasks     ${TASKS.map((t) => t.id).join(", ")}`);
console.log(`  categories ${SCOPE_CATEGORIES.join(", ")}`);
console.log(`  --limit   ${LIMIT}`);
console.log(`  agents    ${agents.length} registered`);
console.log("\n  coverage (verified a2a agents vs. how many already carry gebo_task evidence):");
for (const c of coverage) {
  const pct = c.total ? Math.round(((c.with_evidence ?? 0) / c.total) * 100) : 0;
  console.log(`    ${String(c.category).padEnd(14)} ${String(c.total).padStart(4)} total, ${String(c.with_evidence ?? 0).padStart(4)} with evidence  (${pct}%)`);
}
console.log(`\n`);

/**
 * Resolve the endpoint a card advertises, which is where a client must send work.
 *
 * Any 2xx JSON reply carrying an http(s) `url` field is treated as a card and
 * followed, whatever its path is called - gating on "well-known" in the filename
 * missed our own /api/agent/&lt;persona&gt;/card routes and would have posted tasks
 * at documents. If the GET fails, the body is not a card, or no url is present,
 * the original URL is used unchanged: some registrations name their JSON-RPC
 * endpoint directly.
 */
async function resolveEndpoint(cardUrl: string, signal: AbortSignal): Promise<{ endpoint: string; declared: string | null }> {
  try {
    const res = await fetch(cardUrl, { signal, headers: { accept: "application/json" } });
    if (res.ok) {
      const parsed = parseAgentReply(await res.text(), res.headers.get("content-type"));
      if (parsed.ok) {
        const url = (parsed.body as { url?: unknown }).url;
        if (typeof url === "string" && /^https?:\/\//i.test(url)) {
          return { endpoint: url, declared: url };
        }
      }
    }
  } catch { /* fall through and record the attempt honestly */ }
  return { endpoint: cardUrl, declared: null };
}

async function askAgent(cardUrl: string, question: string) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const { endpoint, declared } = await resolveEndpoint(cardUrl, ac.signal);
    const res = await fetch(endpoint, {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "message/send",
        params: { message: { role: "user", messageId: `gebo-${Date.now()}`, parts: [{ kind: "text", text: question }] } },
      }),
    });
    const raw = await res.text();
    /**
     * Only a JSON object is a protocol reply. Everything else - HTML error
     * pages, SPA shells served with 200, bare strings - is a transport failure
     * whose body must never reach the grader or the attestation record. This
     * check lives here, the single shared path, rather than per-task.
     */
    const parsed = parseAgentReply(raw, res.headers.get("content-type"));
    if (!parsed.ok) {
      return {
        ms: Date.now() - started,
        status: res.status,
        text: "",
        err: parsed.reason,
        endpoint,
        declared,
      };
    }
    /**
     * A JSON-RPC error is the agent declining, not an answer that happens to be wrong.
     *
     * Graded as prose, one such reply scored SUCCEEDED: "unknown skill: None negotiate
     * notify_funded" carried the envelope's own "jsonrpc":"2.0", and a bare 2 is within
     * 15% of a health factor of 1.7824. The report would have claimed an agent
     * correctly reported a ratio it never computed.
     */
    const declined = rpcErrorMessage(parsed.body);
    return {
      ms: Date.now() - started,
      status: res.status,
      // Structured data parts outrank prose: the reference agent answers
      // borrowing-power correctly in its `data` part while prose correctly
      // reports only the supplied amount (no ratio exists). Grading prose-only
      // called that correct answer PARTIAL.
      text: declined ? "" : structuredReplyText(parsed.body),
      err: declined,
      endpoint,
      declared,
    };
  } catch (e: any) {
    const aborted = e?.name === "AbortError";
    return {
      ms: Date.now() - started, status: 0, text: "",
      err: aborted ? `no response within ${TIMEOUT_MS / 1000}s` : String(e?.message ?? e).slice(0, 140),
      endpoint: cardUrl, declared: null,
    };
  } finally { clearTimeout(timer); }
}

const attesterKey = process.env.REPUTATION_WRITER_PRIVATE_KEY as Hex | undefined;
const attester = attesterKey ? privateKeyToAccount(attesterKey).address : null;
if (RECORD && !attester) {
  console.error("  REPUTATION_WRITER_PRIVATE_KEY unset: no attester identity, refusing to record.\n");
  await sql.end();
  process.exit(1);
}

let recorded = 0;

for (const task of TASKS) {
  // ── manual arm first: the truth decides what is worth asking ────────────────
  let manual: ManualResult;
  try {
    manual = await task.runManual();
  } catch (e) {
    console.log(`  TASK ${task.id} - manual arm failed, task skipped: ${String((e as Error).message).slice(0, 120)}\n`);
    continue;
  }
  if (manual.target == null) {
    console.log(`  TASK ${task.id} - no gradeable target this run, skipped.\n`);
    continue;
  }
  const question = manual.question ?? task.question();

  console.log(`  TASK ${task.label} [${task.category}]`);
  console.log(`    MANUAL ARM  ${manual.ms} ms  ->  target ${manual.target}`);
  console.log(`                ${manual.text.slice(0, 150)}\n`);

  /**
   * COST, MEASURED RATHER THAN OMITTED. Both arms read public chain state over
   * the same RPC and pay nothing but bandwidth. Recording null here would read
   * as "unknown"; recording zero with this note states a measured fact. Gas
   * would only enter if an agent's answer required a transaction, which none of
   * these tasks do.
   */
  const zeroCostNote =
    `Both arms are pure chain reads over one shared public RPC: marginal cash cost ` +
    `$0.00 on each side. Timed over reads and arithmetic ONLY, excluding the human ` +
    `time to discover the method, so the manual baseline understates itself and any ` +
    `agent advantage is understated rather than inflated.`;

  for (const agent of agents) {
    const r = await askAgent(agent.url, question);

    // A non-2xx reply is a transport failure, not an answer worth grading.
    const transportFailed = r.err != null || (r.status !== 0 && (r.status < 200 || r.status >= 300));
    const grade = transportFailed
      ? { outcome: "failed" as const, note: r.err ?? `endpoint returned HTTP ${r.status}` }
      : gradeNumericAnswer(r.text, manual.target);

    const label = r.declared && /127\.0\.0\.1|localhost|:\/\/10\.|192\.168\./.test(r.declared)
      ? `card advertises ${r.declared} - unreachable by any client`
      : grade.note;

    console.log(`    ${grade.outcome.toUpperCase().padEnd(10)} #${agent.token_id} ${(agent.name ?? "").slice(0, 30)}`);
    console.log(`               ${r.ms} ms, HTTP ${r.status || "-"}  ${label.slice(0, 96)}`);

    if (!RECORD) continue;

    await sql`
      insert into attestations ${sql({
        chain_id: 56,
        token_id: agent.token_id,
        attester: attester!,
        attester_kind: "gebo",
        evidence_kind: "gebo_task",
        evidence_ref: `${task.id}-${agent.token_id}-${manual.refKey}`,
        evidence_verified: true,
        evidence_checked_at: new Date(),
        outcome: grade.outcome,
        task: question,
        result: r.text ? r.text.slice(0, 4000) : `No usable reply. ${label}`,
        duration_ms: r.ms,
        cost_amount: "0",
        cost_token: "USD",
        baseline_duration_ms: manual.ms,
        baseline_cost_amount: "0",
        baseline_note: `${zeroCostNote} Method: ${label.slice(0, 400)}`,
      } as any)}
      on conflict (chain_id, token_id, evidence_kind, evidence_ref) do update set
        outcome = excluded.outcome,
        result = excluded.result,
        duration_ms = excluded.duration_ms,
        cost_amount = excluded.cost_amount,
        cost_token = excluded.cost_token,
        baseline_duration_ms = excluded.baseline_duration_ms,
        baseline_cost_amount = excluded.baseline_cost_amount,
        baseline_note = excluded.baseline_note,
        evidence_checked_at = now()
    `;
    recorded++;
  }
  console.log("");
}

console.log(`  ${RECORD ? `${recorded} attestation(s) written.` : "Dry run: nothing written."}`);
console.log(`  Every run used the endpoint the registry publishes, one attempt, no retries.`);
console.log(`  Non-JSON replies are rejected before grading; HTML never reaches a record.\n`);

await sql.end({ timeout: 5 });
