/**
 * Verified reviews: the L1 amendment (2026-08-31), implemented.
 *
 * The GPT Store autopsy measured unanchored ratings - self-selected raters, no
 * proof of use - at roughly zero correlation with real usage. That does not
 * condemn reviews; it says where review information lives: in comments from
 * wallets that provably completed a job. This module is that gate.
 *
 * "Proven" means a COMPLETED APEX (ERC-8183) escrow job, not any interaction.
 * Cost-of-attack is the whole game: an x402 call costs 0.01 $U, so gating on
 * interaction is Sybil-cheap; a completed job costs roughly seven
 * transactions, gas, and surviving a dispute window. Every claim below is
 * checked ON CHAIN at write time - never taken from the request:
 *
 *   1. the signature recovers the reviewer's address (EIP-191 personal_sign),
 *      bound to this exact agent + job + comment + timestamp;
 *   2. getJob(jobId) exists on the named chain;
 *   3. its status is Completed (3) - Submitted, Rejected and Expired do not
 *      qualify, and Rejected (the dispute outcome) is excluded deliberately;
 *   4. the job's client IS the signer - only the wallet that hired may review;
 *   5. the job's provider is this agent (owner address or agent wallet), so a
 *      review cannot be pasted onto an agent that was never hired.
 *
 * One review per job (unique constraint) - the anchor is the jobId; the text
 * stays off-chain because on-chain text is undeletable, and at our hire
 * volumes one angry review is 33-100% of the visible signal. Comments, never
 * numbers: nothing here computes a score, an average, or a ranking input.
 */
import postgres from "postgres";
import {
  createPublicClient, http, fallback, parseAbi, verifyMessage,
  type Address, type Hex, type PublicClient,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { buildReviewMessage, validateComment } from "./review-message";

/** The two chains with a known APEX deployment - anything else is a config error, not a lookup. */
export type ApexChainId = 56 | 97;

/** APEX AgenticCommerce proxies, verified on chain (AGENTS.md "APEX"). */
const APEX_COMMERCE: Record<ApexChainId, Address> = {
  56: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
  97: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
};

export function isApexChainId(n: number): n is ApexChainId {
  return n === 56 || n === 97;
}

/** Open, Funded, Submitted, Completed, Rejected, Expired - index 3 is the gate. */
const JOB_STATUS_COMPLETED = 3;

/** A replayed signature older than this is refused; freshness is the anti-replay. */
const SIGNATURE_MAX_AGE_SECONDS = 15 * 60;

const COMMERCE_ABI = parseAbi([
  // getJob returns ONE struct tuple - flat outputs decode garbage (hire-apex.ts).
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
]);

export type ApexJob = {
  id: bigint;
  client: Address;
  provider: Address;
  status: number;
  description: string;
};

export type Review = {
  id: number;
  chainId: number;
  jobId: string;
  tokenId: string;
  reviewer: string;
  comment: string;
  checkedBlock: string;
  createdAt: string;
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

export async function getApexJob(chainId: ApexChainId, jobId: bigint): Promise<ApexJob> {
  const commerce = APEX_COMMERCE[chainId];
  const job = (await chainClient(chainId).readContract({
    address: commerce, abi: COMMERCE_ABI, functionName: "getJob", args: [jobId],
  })) as ApexJob;
  return job;
}

export type ReviewRequest = {
  tokenId: string;
  chainId: ApexChainId;
  jobId: string;
  comment: string;
  reviewer: Address;
  issuedAt: number;
  signature: Hex;
};

export type ReviewResult = { ok: true; id: number; checkedBlock: string } | { ok: false; reason: string };

/**
 * Verify and record one review. Every reason string is user-facing: the form
 * shows it, because a refused gate the user cannot understand is a dead end,
 * and this product does not do dead ends at payment or verification steps.
 */
export async function recordReview(req: ReviewRequest): Promise<ReviewResult> {
  const sql = db();
  if (!sql) return { ok: false, reason: "no database configured" };

  if (!isApexChainId(req.chainId)) {
    return { ok: false, reason: "chain must be 56 (BSC) or 97 (BSC testnet) - the two chains with an APEX deployment" };
  }
  if (!/^\d+$/.test(req.jobId) || req.jobId.length > 20) {
    return { ok: false, reason: "job id must be a number" };
  }
  if (typeof req.issuedAt !== "number" || !Number.isFinite(req.issuedAt)) {
    return { ok: false, reason: "issuedAt must be a unix timestamp in seconds" };
  }
  const age = Math.abs(Math.floor(Date.now() / 1000) - req.issuedAt);
  if (age > SIGNATURE_MAX_AGE_SECONDS) {
    return { ok: false, reason: `signature is ${age}s old - sign again within ${SIGNATURE_MAX_AGE_SECONDS / 60} minutes` };
  }

  const checked = validateComment(req.comment);
  if (!checked.ok) return { ok: false, reason: checked.reason };

  // 1. The signature must recover this address over THIS exact message.
  // A malformed address throws inside viem; a refusal is the honest answer,
  // never an exception that surfaces as a 500.
  const message = buildReviewMessage({
    agentTokenId: req.tokenId,
    chainId: req.chainId,
    jobId: req.jobId,
    comment: checked.comment,
    issuedAt: req.issuedAt,
  });
  let valid: boolean;
  try {
    valid = await verifyMessage({
      address: req.reviewer,
      message,
      signature: req.signature,
    });
  } catch {
    return { ok: false, reason: "reviewer address or signature is malformed" };
  }
  if (!valid) {
    return { ok: false, reason: "signature does not verify for this agent, job and comment" };
  }

  // The agent must exist and the job's provider must be it - read both the
  // registry owner and the declared agent wallet, because a hire binds one of
  // them as the APEX provider.
  const agentRows = await sql<{ owner: string | null; agent_wallet: string | null }[]>`
    select owner, agent_wallet from agents
    where chain_id = 56 and token_id = ${req.tokenId}::bigint
  `;
  const agent = agentRows[0];
  if (!agent) return { ok: false, reason: `agent ${req.tokenId} is not in the registry` };
  const providerIds = new Set(
    [agent.owner, agent.agent_wallet].filter((x): x is string => !!x).map((x) => x.toLowerCase()),
  );

  // 2-5. The on-chain gate. Failures say WHICH check refused, so a refused
  // review is legible rather than a generic "denied".
  let job: ApexJob;
  try {
    job = await getApexJob(req.chainId, BigInt(req.jobId));
  } catch (err: any) {
    return { ok: false, reason: `job ${req.jobId} could not be read on chain ${req.chainId}: ${String(err?.shortMessage ?? err?.message ?? err).slice(0, 90)}` };
  }
  if (job.id !== BigInt(req.jobId)) {
    return { ok: false, reason: `no job with id ${req.jobId} exists on chain ${req.chainId}` };
  }
  if (Number(job.status) !== JOB_STATUS_COMPLETED) {
    const labels = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];
    return { ok: false, reason: `job ${req.jobId} is ${labels[Number(job.status)] ?? `status ${Number(job.status)}`} - reviews require a Completed job` };
  }
  if (job.client.toLowerCase() !== req.reviewer.toLowerCase()) {
    return { ok: false, reason: "this wallet is not the client of that job - only the wallet that hired may review" };
  }
  if (!providerIds.has(job.provider.toLowerCase())) {
    return { ok: false, reason: "that job's provider is not this agent (its owner or agent wallet)" };
  }

  const checkedBlock = await chainClient(req.chainId).getBlockNumber();

  try {
    const rows = await sql<{ id: number }[]>`
      insert into verified_reviews ${sql({
        chain_id: req.chainId,
        job_id: BigInt(req.jobId),
        token_id: req.tokenId,
        reviewer: job.client.toLowerCase(),
        comment: checked.comment,
        job_status: JOB_STATUS_COMPLETED,
        checked_block: checkedBlock,
      } as any)}
      on conflict (chain_id, job_id) do nothing
      returning id
    `;
    if (!rows.length) {
      return { ok: false, reason: `job ${req.jobId} already has its review - one review per completed job` };
    }
    return { ok: true, id: rows[0]!.id, checkedBlock: checkedBlock.toString() };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message ?? err).slice(0, 200) };
  }
}

/**
 * Reviews render on the agent card. Reviews may be anchored to jobs on either
 * chain (GEBO demo hires complete on testnet), so this reads both and each row
 * carries its chain.
 *
 * Returns an explicit `unavailable` flag on failure - an empty list and a
 * failed read must never look alike (invariant 9: a failed measurement is
 * never an empty state).
 */
export async function reviewsFor(
  tokenId: string,
  limit = 25,
): Promise<{ reviews: Review[]; unavailable: boolean; reason: string | null }> {
  const sql = db();
  if (!sql) return { reviews: [], unavailable: true, reason: "DATABASE_URL is not configured" };
  try {
    const rows = await sql<any[]>`
      select id, chain_id, job_id::text as job_id, token_id::text as token_id,
             reviewer, comment, checked_block::text as checked_block, created_at
      from verified_reviews
      where token_id = ${tokenId}::bigint
      order by created_at desc
      limit ${limit}
    `;
    return {
      reviews: rows.map((r) => ({
        id: Number(r.id),
        chainId: Number(r.chain_id),
        jobId: String(r.job_id),
        tokenId: String(r.token_id),
        reviewer: r.reviewer,
        comment: r.comment,
        checkedBlock: String(r.checked_block),
        createdAt: new Date(r.created_at).toISOString(),
      })),
      unavailable: false,
      reason: null,
    };
  } catch (err: any) {
    return { reviews: [], unavailable: true, reason: String(err?.message ?? err).slice(0, 160) };
  }
}
