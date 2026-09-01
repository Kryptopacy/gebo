/**
 * Verified reviews API - the write surface for BOTH humans and agents.
 *
 * A human uses the form on the agent card, which signs in the browser. An
 * agent (or any programmatic client) POSTs the same shape with its own key:
 * the gate is the wallet signature plus the on-chain completed-job check, so
 * the API never needs to know whether the caller has a face. That is the
 * point - agents hired through APEX can review their counterparties with the
 * same evidence requirements as people.
 *
 * POST /api/reviews
 *   { tokenId, chainId, jobId, comment, reviewer, issuedAt, signature }
 *   signature = EIP-191 personal_sign of buildReviewMessage(...) over exactly
 *   these fields (src/lib/review-message.ts builds it client-side too).
 *
 * GET /api/reviews?tokenId=259575
 *   The public read: comments with their on-chain anchors. No scores, no
 *   aggregates, no ordering inputs - a review count is hire volume, not
 *   quality, so it is deliberately absent from every response.
 */
import { NextResponse } from "next/server";
import { recordReview, reviewsFor } from "@/lib/reviews";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Same posture as /mcp: agents call this from their own runtimes.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SIG_RE = /^0x[0-9a-fA-F]{130}$/;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "body must be JSON" }, { status: 400, headers: CORS });
  }

  const tokenId = String(body.tokenId ?? "").trim();
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ ok: false, reason: "tokenId must be the agent's ERC-8004 token id" }, { status: 400, headers: CORS });
  }
  const chainId = Number(body.chainId);
  if (chainId !== 56 && chainId !== 97) {
    return NextResponse.json({ ok: false, reason: "chainId must be 56 or 97" }, { status: 400, headers: CORS });
  }
  const reviewer = String(body.reviewer ?? "").trim();
  if (!ADDRESS_RE.test(reviewer)) {
    return NextResponse.json({ ok: false, reason: "reviewer must be a 0x address" }, { status: 400, headers: CORS });
  }
  const signature = String(body.signature ?? "").trim();
  if (!SIG_RE.test(signature)) {
    return NextResponse.json({ ok: false, reason: "signature must be a 65-byte hex signature" }, { status: 400, headers: CORS });
  }

  const result = await recordReview({
    tokenId,
    chainId,
    jobId: String(body.jobId ?? "").trim(),
    comment: String(body.comment ?? ""),
    reviewer: reviewer as `0x${string}`,
    issuedAt: Number(body.issuedAt),
    signature: signature as `0x${string}`,
  });

  // A refused gate is a 200 with ok:false and a legible reason: the client
  // form renders the reason verbatim, and "unauthorized" would hide WHICH
  // check refused (not your job / not completed / not this agent).
  return NextResponse.json(result, { status: 200, headers: CORS });
}

export async function GET(request: Request) {
  const tokenId = new URL(request.url).searchParams.get("tokenId")?.trim() ?? "";
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ ok: false, reason: "tokenId query parameter is required" }, { status: 400, headers: CORS });
  }
  const { reviews, unavailable, reason } = await reviewsFor(tokenId);
  if (unavailable) {
    // Unmeasured, not zero - the reader must not mistake a failed read for silence.
    return NextResponse.json(
      { ok: false, unavailable: true, reason: reason ?? "reviews could not be read" },
      { status: 503, headers: CORS },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      tokenId,
      count: reviews.length,
      note: reviews.length === 0
        ? "no verified reviews - reviews require a completed APEX escrow job with the reviewer as its client (an absence, not a rating)"
        : "comments are evidence, not scores; they never affect ordering",
      reviews: reviews.map((r) => ({
        job: `chain ${r.chainId} job ${r.jobId}`,
        reviewer: r.reviewer,
        comment: r.comment,
        verified_at_block: r.checkedBlock,
        created_at: r.createdAt,
        url: `/a/${r.tokenId}`,
      })),
    },
    { headers: CORS },
  );
}
