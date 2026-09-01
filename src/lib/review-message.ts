/**
 * Pure helpers shared by the review client (browser) and the review verifier
 * (server). Kept free of database and chain imports so the browser bundle
 * only carries viem's hash primitives.
 *
 * The signature is the reviewer's proof of identity, and it must bind to the
 * EXACT review being submitted: agent, chain, job, comment text, and issue
 * time all appear in the signed message, so a signature cannot be replayed
 * against a different comment or a different agent's card. The comment enters
 * as a keccak digest to keep wallet dialogs short.
 *
 * ASCII-only source (Windows-1252 write hazard).
 */
import { keccak256, toBytes } from "viem";

export const REVIEW_SIGNATURE_VERSION = "gebo-review-v1";

export const COMMENT_MIN = 16;
export const COMMENT_MAX = 2000;

/** Server and client must reject the same text, or the UX lies about the gate. */
export function validateComment(raw: string): { ok: true; comment: string } | { ok: false; reason: string } {
  const comment = raw.trim();
  if (comment.length < COMMENT_MIN) {
    return { ok: false, reason: `a comment needs at least ${COMMENT_MIN} characters (after trimming)` };
  }
  if (comment.length > COMMENT_MAX) {
    return { ok: false, reason: `a comment is capped at ${COMMENT_MAX} characters` };
  }
  return { ok: true, comment };
}

export type ReviewMessageParts = {
  agentTokenId: string;
  chainId: number;
  jobId: string;
  comment: string;
  issuedAt: number;
};

/** Canonical EIP-191 payload for personal_sign. Rebuilt server-side from the submitted fields. */
export function buildReviewMessage(parts: ReviewMessageParts): string {
  return [
    `GEBO verified review (${REVIEW_SIGNATURE_VERSION})`,
    `agent: ${parts.agentTokenId}`,
    `job: ${parts.chainId}:${parts.jobId}`,
    `comment digest: ${keccak256(toBytes(parts.comment))}`,
    `issued at: ${parts.issuedAt}`,
    ``,
    `Signing publishes this comment on the agent's public card, bound to APEX escrow job ${parts.jobId} on chain ${parts.chainId}, which the verifier will check reached Completed with your address as its client.`,
  ].join("\n");
}
