/**
 * Pins for the verified-review gate's pure half: the canonical signed message
 * and the comment bounds. The on-chain half (job status, client, provider) is
 * verified by scripts/e2e against a live chain, not mocked here - a mocked
 * gate proves nothing about Sybil resistance.
 */
import { describe, expect, it } from "vitest";
import {
  buildReviewMessage, validateComment, COMMENT_MIN, COMMENT_MAX,
} from "../src/lib/review-message";

describe("validateComment", () => {
  it("accepts a real comment and trims it", () => {
    const r = validateComment("  Did exactly what the brief said, fast.  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comment).toBe("Did exactly what the brief said, fast.");
  });

  it(`rejects below ${COMMENT_MIN} chars (trimmed) with a legible reason`, () => {
    const r = validateComment("   fine   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("at least");
  });

  it(`rejects above ${COMMENT_MAX} chars`, () => {
    const r = validateComment("x".repeat(COMMENT_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("capped");
  });

  it("accepts exactly the bounds", () => {
    expect(validateComment("y".repeat(COMMENT_MIN)).ok).toBe(true);
    expect(validateComment("y".repeat(COMMENT_MAX)).ok).toBe(true);
  });
});

describe("buildReviewMessage", () => {
  const parts = {
    agentTokenId: "259575",
    chainId: 97,
    jobId: "609",
    comment: "Delivered the health check inside the window.",
    issuedAt: 1_769_000_000,
  };

  it("is deterministic for identical parts", () => {
    expect(buildReviewMessage(parts)).toBe(buildReviewMessage({ ...parts }));
  });

  it("binds agent, chain, job and issue time in cleartext", () => {
    const m = buildReviewMessage(parts);
    expect(m).toContain("agent: 259575");
    expect(m).toContain("job: 97:609");
    expect(m).toContain("issued at: 1769000000");
  });

  it("changes when the comment changes - a signature cannot be replayed on edited text", () => {
    const m1 = buildReviewMessage(parts);
    const m2 = buildReviewMessage({ ...parts, comment: parts.comment + " Edited." });
    expect(m1).not.toBe(m2);
    expect(m1).not.toEqual(m2);
  });

  it("changes when the agent or job changes", () => {
    const base = buildReviewMessage(parts);
    expect(buildReviewMessage({ ...parts, agentTokenId: "259573" })).not.toBe(base);
    expect(buildReviewMessage({ ...parts, jobId: "670" })).not.toBe(base);
    expect(buildReviewMessage({ ...parts, chainId: 56 })).not.toBe(base);
  });
});
