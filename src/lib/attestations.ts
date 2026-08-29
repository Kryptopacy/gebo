/**
 * Attestations: feedback anchored to a verifiable interaction.
 *
 * Probing proves an agent answers. It cannot prove the agent does the job well,
 * and that gap is where reputation systems normally fail - they close it with
 * opinions, which are cheap to manufacture. In the largest comparable
 * marketplace, rating value correlated about zero with real usage, and ERC-8004's
 * own specification refuses unfiltered aggregation because it is Sybil-farmable.
 *
 * So an attestation must carry evidence, and the evidence is CHECKED ON CHAIN
 * rather than trusted:
 *
 *   session_execution  a transaction that actually executed on the agent's wallet
 *   erc8183_job        a job escrow that reached a settled state
 *   x402_payment       a settled per-call payment
 *   gebo_task          a task GEBO ran itself, with the output retained
 *
 * An address with no interaction cannot attest at all. Nothing here produces a
 * star rating or a single score: counts by outcome are returned, so a reader can
 * weigh evidence kinds themselves and there is no one number to game.
 */
import postgres from "postgres";
import { createPublicClient, http, fallback, type Address, type Hex, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import type { TaskRun } from "./advantage";

export type EvidenceKind = "session_execution" | "erc8183_job" | "x402_payment" | "gebo_task";
export type Outcome = "succeeded" | "partial" | "failed" | "disputed";
export type AttesterKind = "wallet" | "agent" | "gebo";

export type Attestation = {
  id: number;
  chainId: number;
  tokenId: string;
  attester: string;
  attesterKind: AttesterKind;
  evidenceKind: EvidenceKind;
  evidenceRef: string;
  evidenceVerified: boolean;
  outcome: Outcome;
  task: string | null;
  result: string | null;
  durationMs: number | null;
  baselineDurationMs: number | null;
  baselineNote: string | null;
  onchainTx: string | null;
  createdAt: string;
  attesterTrusted: boolean;
};

export type AttestationSummary = {
  total: number;
  verified: number;
  succeeded: number;
  partial: number;
  failed: number;
  disputed: number;
  distinctAttesters: number;
  trustedAttesters: number;
  evidenceKinds: Record<string, number>;
  medianDurationMs: number | null;
};

let client: ReturnType<typeof postgres> | null = null;
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = postgres(url, { prepare: false, max: 3, connect_timeout: 8, idle_timeout: 20, onnotice: () => {} });
  }
  return client;
}

function chainClient(chainId: number): PublicClient {
  const urls = chainId === 97
    ? [process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com"]
    : [process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com", "https://binance.llamarpc.com"];
  return createPublicClient({
    chain: chainId === 97 ? bscTestnet : bsc,
    transport: fallback(urls.map((u) => http(u, { timeout: 12_000, retryCount: 1 }))),
  }) as PublicClient;
}

/**
 * Verify the evidence actually exists on chain.
 *
 * This is the whole point. An unverified attestation is an opinion, so it is
 * stored with evidence_verified = false and never counted as proof.
 */
export async function verifyEvidence(
  kind: EvidenceKind,
  ref: string,
  chainId = 56,
): Promise<{ verified: boolean; reason: string }> {
  // A task GEBO ran itself is verified by our own retained record, not by chain.
  if (kind === "gebo_task") {
    return { verified: true, reason: "task executed by GEBO with the output retained" };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(ref.trim())) {
    return { verified: false, reason: "evidence reference is not a transaction hash" };
  }

  try {
    const pub = chainClient(chainId);
    const receipt = await pub.getTransactionReceipt({ hash: ref.trim() as Hex });
    if (receipt.status !== "success") {
      return { verified: false, reason: `transaction reverted (status ${receipt.status})` };
    }
    return {
      verified: true,
      reason: `transaction succeeded in block ${receipt.blockNumber}, ${receipt.logs.length} log(s)`,
    };
  } catch (err: any) {
    return {
      verified: false,
      reason: `transaction not found: ${String(err?.shortMessage ?? err?.message ?? err).slice(0, 90)}`,
    };
  }
}

export type NewAttestation = {
  chainId?: number;
  tokenId: string;
  attester: string;
  attesterKind: AttesterKind;
  evidenceKind: EvidenceKind;
  evidenceRef: string;
  outcome: Outcome;
  task?: string | null;
  result?: string | null;
  durationMs?: number | null;
  costAmount?: bigint | null;
  costToken?: string | null;
  baselineDurationMs?: number | null;
  baselineCostAmount?: bigint | null;
  baselineNote?: string | null;
};

/**
 * Record an attestation, verifying its evidence first.
 *
 * Refuses outright when the evidence cannot be confirmed and the claim is not a
 * task we ran ourselves - an unanchored claim has no place in an evidence ledger.
 */
export async function recordAttestation(
  a: NewAttestation,
): Promise<{ ok: true; id: number; reason: string } | { ok: false; reason: string }> {
  const sql = db();
  if (!sql) return { ok: false, reason: "no database configured" };

  const chainId = a.chainId ?? 56;
  const { verified, reason } = await verifyEvidence(a.evidenceKind, a.evidenceRef, chainId);

  if (!verified) {
    return { ok: false, reason: `evidence rejected: ${reason}` };
  }

  try {
    const rows = await sql<{ id: number }[]>`
      insert into attestations ${sql({
        chain_id: chainId,
        token_id: a.tokenId,
        attester: a.attester.toLowerCase(),
        attester_kind: a.attesterKind,
        evidence_kind: a.evidenceKind,
        evidence_ref: a.evidenceRef.trim(),
        evidence_verified: true,
        evidence_checked_at: new Date(),
        outcome: a.outcome,
        task: a.task ?? null,
        result: a.result ?? null,
        duration_ms: a.durationMs ?? null,
        cost_amount: a.costAmount != null ? a.costAmount.toString() : null,
        cost_token: a.costToken ?? null,
        baseline_duration_ms: a.baselineDurationMs ?? null,
        baseline_cost_amount: a.baselineCostAmount != null ? a.baselineCostAmount.toString() : null,
        baseline_note: a.baselineNote ?? null,
      } as any)}
      on conflict (chain_id, token_id, evidence_kind, evidence_ref) do nothing
      returning id
    `;

    if (!rows.length) {
      return { ok: false, reason: "this interaction has already been attested" };
    }

    // Keep the reviewer set current, so the ERC-8004 clientAddresses filter has
    // something to filter by.
    await sql`
      insert into reviewers ${sql({
        address: a.attester.toLowerCase(),
        trusted: a.attesterKind === "gebo",
        note: a.attesterKind === "gebo" ? "GEBO task runner" : "observed attester",
        label: a.attesterKind,
      } as any)}
      on conflict (address) do update set attestation_count = reviewers.attestation_count + 1
    `;

    return { ok: true, id: rows[0]!.id, reason };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message ?? err).slice(0, 200) };
  }
}

export async function attestationsFor(tokenId: string, chainId = 56, limit = 25): Promise<Attestation[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = await sql<any[]>`
      select a.*, coalesce(r.trusted, false) as attester_trusted
      from attestations a
      left join reviewers r on r.address = a.attester
      where a.chain_id = ${chainId} and a.token_id = ${tokenId}
      order by a.evidence_verified desc, a.created_at desc
      limit ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      chainId: Number(r.chain_id),
      tokenId: String(r.token_id),
      attester: r.attester,
      attesterKind: r.attester_kind,
      evidenceKind: r.evidence_kind,
      evidenceRef: r.evidence_ref,
      evidenceVerified: r.evidence_verified,
      outcome: r.outcome,
      task: r.task ?? null,
      result: r.result ?? null,
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
      baselineDurationMs: r.baseline_duration_ms == null ? null : Number(r.baseline_duration_ms),
      baselineNote: r.baseline_note ?? null,
      onchainTx: r.onchain_tx ?? null,
      createdAt: new Date(r.created_at).toISOString(),
      attesterTrusted: Boolean(r.attester_trusted),
    }));
  } catch {
    return [];
  }
}

/**
 * Task runs carrying BOTH arms of the counterfactual.
 *
 * The Agent Advantage question - did hiring this beat doing it myself - can only
 * be answered by a row that recorded the manual arm as well as the agent arm. Most
 * attestations will not: a session execution proves an agent did something, not
 * what the alternative cost. So this filters to rows with a baseline rather than
 * inferring one, because a made-up baseline is the easiest place to manufacture an
 * advantage.
 *
 * Returns an explicit `unavailable` flag instead of an empty array on failure.
 * An empty list and a failed read look identical to a page, and this project has
 * already shipped "0 probes" for 43,456 probes once.
 */
export async function taskRuns(
  chainId = 56,
  limit = 100,
  tokenId?: string,
): Promise<{ runs: TaskRun[]; unavailable: boolean; reason: string | null }> {
  const sql = db();
  if (!sql) {
    return { runs: [], unavailable: true, reason: "DATABASE_URL is not configured" };
  }
  try {
    const rows = await sql<any[]>`
      select
        a.token_id::text as token_id,
        ag.name          as agent_name,
        ag.category      as category,
        a.task, a.result, a.outcome,
        a.duration_ms, a.cost_amount, a.cost_token,
        a.baseline_duration_ms, a.baseline_cost_amount, a.baseline_note,
        a.evidence_kind, a.evidence_ref, a.evidence_verified,
        a.attester, a.created_at
      from attestations a
      left join agents ag
        on ag.chain_id = a.chain_id and ag.token_id = a.token_id
      where a.chain_id = ${chainId}
        ${tokenId ? sql`and a.token_id = ${tokenId}` : sql``}
        -- A run without a manual arm cannot answer the question being asked.
        and (a.baseline_duration_ms is not null or a.baseline_cost_amount is not null)
        /**
         * Exclude rows nobody stands behind.
         *
         * The first baselined row in this table was a self-check written to prove
         * the attestation path retained a task and its output. Honest as plumbing,
         * but it compared a database write against an ESTIMATED manual process, and
         * the page rendered it as "1.2s against 2m 36s, 98.7% saved" - a
         * counterfactual finding built from a smoke test.
         *
         * The zero address is the structural tell: an attestation with no real
         * attester is not evidence, whatever its numbers say. Filtering on the task
         * wording instead would break the moment someone rephrased it.
         */
        and a.attester <> '0x0000000000000000000000000000000000000000'
      order by a.created_at desc
      limit ${limit}
    `;

    const runs: TaskRun[] = rows.map((r) => ({
      tokenId: String(r.token_id),
      agentName: r.agent_name ?? null,
      category: r.category ?? null,
      task: r.task ?? "(task not recorded)",
      result: r.result ?? null,
      outcome: r.outcome,
      agentMs: r.duration_ms == null ? null : Number(r.duration_ms),
      // numeric(38,0) arrives as a string; BigInt keeps 18-decimal amounts exact.
      agentCost: r.cost_amount == null ? null : BigInt(r.cost_amount),
      costToken: r.cost_token ?? null,
      manualMs: r.baseline_duration_ms == null ? null : Number(r.baseline_duration_ms),
      manualCost: r.baseline_cost_amount == null ? null : BigInt(r.baseline_cost_amount),
      manualNote: r.baseline_note ?? null,
      evidenceKind: r.evidence_kind,
      evidenceRef: r.evidence_ref,
      evidenceVerified: Boolean(r.evidence_verified),
      attester: r.attester,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    return { runs, unavailable: false, reason: null };
  } catch (err: any) {
    return {
      runs: [],
      unavailable: true,
      reason: String(err?.message ?? err).slice(0, 160),
    };
  }
}

export async function attestationSummary(tokenId: string, chainId = 56): Promise<AttestationSummary | null> {
  const sql = db();
  if (!sql) return null;
  try {
    const rows = await sql<any[]>`select * from attestation_summary(${chainId}, ${tokenId})`;
    const r = rows[0];
    if (!r || Number(r.total) === 0) return null;
    return {
      total: Number(r.total),
      verified: Number(r.verified),
      succeeded: Number(r.succeeded),
      partial: Number(r.partial),
      failed: Number(r.failed),
      disputed: Number(r.disputed),
      distinctAttesters: Number(r.distinct_attesters),
      trustedAttesters: Number(r.trusted_attesters),
      evidenceKinds: (r.evidence_kinds ?? {}) as Record<string, number>,
      medianDurationMs: r.median_duration_ms == null ? null : Number(r.median_duration_ms),
    };
  } catch {
    return null;
  }
}

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  session_execution: "Session-key transaction",
  erc8183_job: "Settled job escrow",
  x402_payment: "Settled per-call payment",
  gebo_task: "Task run by GEBO",
};

export const EVIDENCE_NOTE: Record<EvidenceKind, string> = {
  session_execution: "A transaction that executed on the agent's own wallet within its granted scope.",
  erc8183_job: "An ERC-8183 job escrow that reached a settled state, so payment moved on an evaluated outcome.",
  x402_payment: "A per-call payment that settled, so the service was actually bought.",
  gebo_task: "GEBO hired the agent and kept the output, so the result can be inspected rather than taken on trust.",
};
