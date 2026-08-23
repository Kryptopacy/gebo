/**
 * Run a real task both ways, and record what happened.
 *
 * The Agent Advantage Report requires at least three tasks done with AND without
 * an agent, with the outputs attached. This is the harness that produces them.
 *
 * THE QUESTION IS CHOSEN SO THE ANSWER EXISTS INDEPENDENTLY. "What is the best
 * stablecoin supply APR on Venus" is derivable from supplyRatePerBlock on every
 * market, so the manual arm is not an estimate and the agent's reply can be checked
 * rather than admired. A task whose answer is a matter of taste cannot be graded,
 * and a report full of ungradeable tasks is a brochure.
 *
 * THE MANUAL ARM IS TIMED HONESTLY. It performs the same chain reads the
 * opportunities job performs - getAllMarkets, then supplyRatePerBlock per market,
 * annualised at Venus's 10,512,000 blocks. That is genuinely what someone would do
 * without an agent, and the clock covers the reads and the arithmetic. What it
 * cannot include is the time a human spends finding out that this is the method,
 * which understates the manual arm and therefore understates any agent advantage.
 * Stated rather than quietly enjoyed.
 *
 * IT IS BUILT TO RECORD AGENTS LOSING. Most VERIFIED agents passed a handshake,
 * which proves an interface exists, not that it does work. A run where four agents
 * never answer and one returns prose without a number is a real finding and gets
 * recorded as such: failed and partial outcomes are the expected majority, and
 * nothing here retries an agent into looking better.
 *
 * Run: npx tsx scripts/run-task.ts            (dry run, records nothing)
 *      npx tsx scripts/run-task.ts --record   (writes attestations)
 */
import "dotenv/config";
import postgres from "postgres";
import { createPublicClient, http, fallback, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { gradeNumericAnswer, replyText } from "../src/lib/task-grade.ts";

const RECORD = process.argv.includes("--record");
const AGENT_TIMEOUT_MS = 45_000;

const VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;
/** Venus annualises per-block rates against this constant, not against real BSC block time. */
const VENUS_BLOCKS_PER_YEAR = 10_512_000;

const comptrollerAbi = parseAbi(["function getAllMarkets() view returns (address[])"]);
const vTokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function supplyRatePerBlock() view returns (uint256)",
]);

const chain = createPublicClient({
  chain: bsc,
  transport: fallback(
    [
      process.env.BSC_MAINNET_RPC,
      "https://bsc-rpc.publicnode.com",
      "https://binance.llamarpc.com",
    ]
      .filter(Boolean)
      .map((u) => http(u as string, { timeout: 20_000, retryCount: 1 })),
  ),
});

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });

/** The manual arm: derive the answer from chain, timed. */
async function manualArm() {
  const started = Date.now();
  const markets = (await chain.readContract({
    address: VENUS_COMPTROLLER,
    abi: comptrollerAbi,
    functionName: "getAllMarkets",
  })) as readonly Address[];

  const reads = await chain.multicall({
    contracts: markets.flatMap((m) => [
      { address: m, abi: vTokenAbi, functionName: "symbol" as const },
      { address: m, abi: vTokenAbi, functionName: "supplyRatePerBlock" as const },
    ]),
    allowFailure: true,
  });

  let best = { symbol: "", apr: 0 };
  const all: { symbol: string; apr: number }[] = [];
  for (let i = 0; i < markets.length; i++) {
    const sym = reads[i * 2];
    const rate = reads[i * 2 + 1];
    if (sym?.status !== "success" || rate?.status !== "success") continue;
    const symbol = String(sym.result);
    const apr = (Number(rate.result as bigint) / 1e18) * VENUS_BLOCKS_PER_YEAR * 100;
    all.push({ symbol, apr });
    // Stablecoin markets only; the question asks about stablecoins.
    if (/USD|DAI|FDUSD/i.test(symbol) && apr > best.apr) best = { symbol, apr };
  }

  const ms = Date.now() - started;
  return {
    ms,
    best,
    marketCount: markets.length,
    readCount: all.length,
    note:
      `Read Venus getAllMarkets (${markets.length} markets), then symbol and ` +
      `supplyRatePerBlock for each via multicall, annualised at ${VENUS_BLOCKS_PER_YEAR.toLocaleString()} ` +
      `blocks/year. Highest stablecoin supply APR: ${best.symbol} at ${best.apr.toFixed(4)}%. ` +
      `Timed over the chain reads and arithmetic only; it excludes the time a person ` +
      `would spend discovering that this is the method, so it understates the manual arm.`,
  };
}

type Candidate = { tokenId: string; name: string | null; category: string | null; kind: string; url: string };

/**
 * Agents worth asking: verified, with a live endpoint, in a category where the
 * question is in scope.
 *
 * "Callable" is not a column - it is the outcome of a probe. VERIFIED trust_state
 * already means the endpoint completed a protocol handshake, so joining endpoints
 * to a verified agent is the same filter expressed correctly.
 */
async function candidates(limit = 6): Promise<Candidate[]> {
  const rows = await sql<any[]>`
    select a.token_id::text as token_id, a.name, a.category, e.kind, e.url
    from agents a
    join agent_endpoints e
      on e.chain_id = a.chain_id and e.token_id = a.token_id
    where a.chain_id = 56
      and a.trust_state = 'VERIFIED'
      and a.category in ('yield', 'rebalancing', 'trading', 'health', 'research', 'data')
    order by (a.category = 'yield') desc, a.token_id desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    tokenId: r.token_id,
    name: r.name,
    category: r.category,
    kind: r.kind,
    url: r.url,
  }));
}

/**
 * Resolve the A2A service endpoint from the agent card.
 *
 * The registry stores the CARD url, commonly /.well-known/agent-card.json. That is
 * a document, not an RPC endpoint - the card's own `url` field names where
 * message/send should go. POSTing to the card path produced 404s and 405s from
 * several agents, and an earlier version of this harness recorded those as agent
 * failures. They were our failures. A report that blames an agent for the harness
 * addressing it incorrectly is worse than no report.
 */
async function resolveA2AEndpoint(cardUrl: string, signal: AbortSignal): Promise<string> {
  if (!/\.well-known|agent-card|agent\.json/i.test(cardUrl)) return cardUrl;
  try {
    const res = await fetch(cardUrl, { signal, headers: { accept: "application/json" } });
    if (!res.ok) return cardUrl;
    const card = (await res.json()) as Record<string, unknown>;
    const declared =
      (typeof card.url === "string" && card.url) ||
      (typeof (card as any).endpoint === "string" && (card as any).endpoint) ||
      null;
    if (declared && /^https?:\/\//i.test(declared)) return declared;
  } catch {
    /* fall back to the card url and let the attempt be recorded honestly */
  }
  return cardUrl;
}

/**
 * The agent arm. A2A gets a message/send; MCP gets tools/list then tools/call.
 *
 * One attempt, no retry. Retrying until an agent looks good is how a benchmark
 * becomes a brochure, and the liveness ledger already exists to describe agents
 * that answer intermittently.
 */
async function askAgent(c: Candidate, question: string) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AGENT_TIMEOUT_MS);

  try {
    if (c.kind?.toLowerCase() === "mcp") {
      const list = await fetch(c.url, {
        method: "POST",
        signal: ac.signal,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      const listBody = await list.text();
      let toolName: string | null = null;
      try {
        const parsed = JSON.parse(listBody.replace(/^data:\s*/m, ""));
        const tools = parsed?.result?.tools;
        if (Array.isArray(tools) && tools.length) toolName = String(tools[0]?.name ?? "");
      } catch {
        /* fall through: no tool to call */
      }
      if (!toolName) {
        return { ms: Date.now() - started, status: list.status, text: "", err: "MCP exposed no callable tool" };
      }
      const call = await fetch(c.url, {
        method: "POST",
        signal: ac.signal,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: toolName, arguments: { query: question, question, input: question } },
        }),
      });
      const body = await call.text();
      let json: unknown = body;
      try { json = JSON.parse(body.replace(/^data:\s*/m, "")); } catch { /* keep raw */ }
      return { ms: Date.now() - started, status: call.status, text: replyText(json), err: null, tool: toolName };
    }

    // A2A: JSON-RPC message/send carrying a text part, to the endpoint the card
    // declares rather than to the card itself.
    const endpoint = await resolveA2AEndpoint(c.url, ac.signal);
    const res = await fetch(endpoint, {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            messageId: `gebo-${Date.now()}`,
            parts: [{ kind: "text", text: question }],
          },
        },
      }),
    });
    const body = await res.text();
    let json: unknown = body;
    try { json = JSON.parse(body); } catch { /* keep raw */ }
    return { ms: Date.now() - started, status: res.status, text: replyText(json), err: null, endpoint };
  } catch (e: any) {
    const aborted = e?.name === "AbortError";
    return {
      ms: Date.now() - started,
      status: 0,
      text: "",
      err: aborted ? `no response within ${AGENT_TIMEOUT_MS / 1000}s` : String(e?.message ?? e).slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── run ──────────────────────────────────────────────────────────────────────

const QUESTION =
  "What is the highest stablecoin supply APR currently available on Venus Protocol on BNB Chain? Reply with the market symbol and the APR as a percentage.";

console.log(`\n  TASK: ${QUESTION}\n`);
console.log(`  mode: ${RECORD ? "RECORD (writes attestations)" : "dry run (records nothing)"}\n`);

const manual = await manualArm();
console.log(`  MANUAL ARM (no agent)`);
console.log(`    ${manual.best.symbol} at ${manual.best.apr.toFixed(4)}%`);
console.log(`    ${manual.readCount}/${manual.marketCount} markets read in ${manual.ms} ms\n`);

if (!manual.best.symbol) {
  console.error("  Manual arm produced no answer, so nothing can be graded. Aborting.\n");
  await sql.end();
  process.exit(1);
}

const attesterKey = process.env.REPUTATION_WRITER_PRIVATE_KEY as `0x${string}` | undefined;
const attester = attesterKey ? privateKeyToAccount(attesterKey).address : null;
if (RECORD && !attester) {
  console.error("  REPUTATION_WRITER_PRIVATE_KEY is unset, so there is no attester identity.");
  console.error("  Refusing to record: an attestation nobody stands behind is not evidence.\n");
  await sql.end();
  process.exit(1);
}

const agents = await candidates();
console.log(`  AGENT ARM: asking ${agents.length} verified agent(s)\n`);

let recorded = 0;
for (const c of agents) {
  const r = await askAgent(c, QUESTION);

  /**
   * A non-2xx response is a transport failure, not an answer.
   *
   * Grading the body of an error page produced nonsense that flattered the agents:
   * an HTML 404 page scored `partial` because the tokeniser pulled "-8" out of
   * <meta charset="utf-8">. Partial implies the agent engaged with the question.
   * It did not - the request never reached anything that could.
   */
  const transportFailed = r.err != null || (r.status !== 0 && (r.status < 200 || r.status >= 300));

  const grade = transportFailed
    ? {
        outcome: "failed" as const,
        matched: null,
        found: [] as number[],
        note: r.err ?? `endpoint returned HTTP ${r.status}, so no answer was received`,
      }
    : gradeNumericAnswer(r.text, manual.best.apr);

  console.log(`  ${grade.outcome.toUpperCase().padEnd(10)} #${c.tokenId} ${(c.name ?? "").slice(0, 34)}`);
  console.log(`             ${c.kind} ${((r as any).endpoint ?? c.url).slice(0, 62)}`);
  console.log(`             ${r.ms} ms, HTTP ${r.status || "-"}`);
  console.log(`             ${grade.note.slice(0, 130)}`);
  if (r.text && !transportFailed) console.log(`             reply: ${r.text.slice(0, 130).replace(/\s+/g, " ")}`);
  console.log("");

  if (!RECORD) continue;

  await sql`
    insert into attestations ${sql({
      chain_id: 56,
      token_id: c.tokenId,
      attester: attester!,
      attester_kind: "gebo",
      evidence_kind: "gebo_task",
      evidence_ref: `venus-apr-${c.tokenId}-${Date.now()}`,
      evidence_verified: true,
      evidence_checked_at: new Date(),
      outcome: grade.outcome,
      task: QUESTION,
      result: r.text ? r.text.slice(0, 4000) : `no usable reply: ${grade.note}`,
      duration_ms: r.ms,
      baseline_duration_ms: manual.ms,
      baseline_note: manual.note,
    } as any)}
    on conflict (chain_id, token_id, evidence_kind, evidence_ref) do nothing
  `;
  recorded++;
}

console.log(`  ${RECORD ? `${recorded} attestation(s) recorded.` : "Dry run: nothing written."}`);
console.log(`  Manual arm: ${manual.ms} ms. Agent arms above, one attempt each, no retries.\n`);

await sql.end({ timeout: 5 });
