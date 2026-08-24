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
 * Run: npx tsx scripts/run-advantage.ts            (dry run)
 *      npx tsx scripts/run-advantage.ts --record   (writes attestations)
 */
import "dotenv/config";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { healthFactorFor, summarise } from "../src/lib/venus.ts";
import { gradeNumericAnswer, replyText, rpcErrorMessage } from "../src/lib/task-grade.ts";

const RECORD = process.argv.includes("--record");
const TIMEOUT_MS = 45_000;

/** Addresses with known, validated Venus state. Chosen for variety of outcome. */
const SUBJECTS: { address: Address; note: string }[] = [
  { address: "0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055", note: "live borrowing position across 4 markets" },
  { address: "0x05eCa5cE85CFD18A52e475544BEcA4D1d5bf4acB", note: "collateral in 5 markets, no debt" },
  { address: "0x913bf7DAf9C48AcA2671603C515026A9902225a5", note: "collateral in 5 markets, no debt" },
];

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, onnotice: () => {} });

/** Registered agents whose declared job covers this question. */
const agents = await sql<{ token_id: string; name: string | null; category: string | null; url: string; kind: string }[]>`
  select a.token_id::text as token_id, a.name, a.category, e.url, e.kind
  from agents a
  join agent_endpoints e on e.chain_id = a.chain_id and e.token_id = a.token_id
  where a.chain_id = 56
    and a.trust_state = 'VERIFIED'
    and a.category in ('health', 'rebalancing')
    and e.kind = 'a2a'
  order by (a.category = 'health') desc, a.token_id desc
  limit 4
`;

console.log(`\n  AGENT ADVANTAGE: Venus health factor`);
console.log(`  ${"=".repeat(70)}`);
console.log(`  mode      ${RECORD ? "RECORD" : "dry run"}`);
console.log(`  subjects  ${SUBJECTS.length}`);
console.log(`  agents    ${agents.length} registered, plus our reference implementation\n`);

/**
 * Resolve the endpoint a card advertises, which is where a client must send work.
 * Following it is the whole point: five agents publish a reachable card naming an
 * endpoint only their author can reach, and a harness that skipped this step would
 * never notice.
 */
async function resolveEndpoint(cardUrl: string, signal: AbortSignal): Promise<{ endpoint: string; declared: string | null }> {
  if (!/well-known|agent-card|agent\.json/i.test(cardUrl)) return { endpoint: cardUrl, declared: null };
  try {
    const res = await fetch(cardUrl, { signal, headers: { accept: "application/json" } });
    if (!res.ok) return { endpoint: cardUrl, declared: null };
    const card = (await res.json()) as { url?: unknown };
    if (typeof card.url === "string" && /^https?:\/\//i.test(card.url)) {
      return { endpoint: card.url, declared: card.url };
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
    let json: unknown = raw;
    try { json = JSON.parse(raw); } catch { /* keep raw */ }
    /**
     * A JSON-RPC error is the agent declining, not an answer that happens to be wrong.
     *
     * Graded as prose, one such reply scored SUCCEEDED: "unknown skill: None negotiate
     * notify_funded" carried the envelope's own "jsonrpc":"2.0", and a bare 2 is within
     * 15% of a health factor of 1.7824. The report would have claimed an agent
     * correctly reported a ratio it never computed.
     */
    const declined = rpcErrorMessage(json);
    return {
      ms: Date.now() - started,
      status: res.status,
      text: replyText(json),
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

for (const subject of SUBJECTS) {
  const question =
    `What is the Venus lending health factor for ${subject.address} on BNB Chain? ` +
    `Report the ratio and whether the position is at risk of liquidation.`;

  // ── manual arm, timed ──────────────────────────────────────────────────────
  const mStart = Date.now();
  const truth = await healthFactorFor(subject.address);
  const manualMs = Date.now() - mStart;
  const truthText = summarise(truth);

  /**
   * The gradeable number. For a position with no debt there is no ratio, so the
   * borrowing power is graded instead - an agent that reports the collateral value
   * correctly has answered the question that applies.
   */
  const target = truth.healthFactor ?? truth.borrowingPowerUsd;

  console.log(`  SUBJECT ${subject.address}`);
  console.log(`    ${subject.note}`);
  console.log(`    MANUAL ARM  ${manualMs} ms  ->  ${truth.verdict}, target ${target.toFixed(4)}`);
  console.log(`                ${truthText.slice(0, 150)}\n`);

  const manualNote =
    `Computed from chain in ${manualMs} ms: Venus getAssetsIn, then getAccountSnapshot, ` +
    `markets() and the oracle price per market, with the 36-minus-underlying-decimals ` +
    `price scaling and per-market collateral factors applied. Validated against Venus's ` +
    `own getAccountLiquidity. Timed over the reads and arithmetic ONLY - it excludes the ` +
    `time a person spends discovering that this is the method, so it understates the ` +
    `manual arm and therefore understates any agent advantage.`;

  for (const agent of agents) {
    const r = await askAgent(agent.url, question);

    // A non-2xx reply is a transport failure, not an answer worth grading.
    const transportFailed = r.err != null || (r.status !== 0 && (r.status < 200 || r.status >= 300));
    const grade = transportFailed
      ? { outcome: "failed" as const, note: r.err ?? `endpoint returned HTTP ${r.status}` }
      : gradeNumericAnswer(r.text, target);

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
        evidence_ref: `venus-hf-${agent.token_id}-${subject.address.slice(2, 10)}`,
        evidence_verified: true,
        evidence_checked_at: new Date(),
        outcome: grade.outcome,
        task: question,
        result: r.text ? r.text.slice(0, 4000) : `No usable reply. ${label}`,
        duration_ms: r.ms,
        baseline_duration_ms: manualMs,
        baseline_note: manualNote,
      } as any)}
      on conflict (chain_id, token_id, evidence_kind, evidence_ref) do update set
        outcome = excluded.outcome,
        result = excluded.result,
        duration_ms = excluded.duration_ms,
        baseline_duration_ms = excluded.baseline_duration_ms,
        baseline_note = excluded.baseline_note,
        evidence_checked_at = now()
    `;
    recorded++;
  }
  console.log("");
}

console.log(`  ${RECORD ? `${recorded} attestation(s) written.` : "Dry run: nothing written."}`);
console.log(`  Every run used the endpoint the registry publishes, one attempt, no retries.\n`);

await sql.end({ timeout: 5 });
