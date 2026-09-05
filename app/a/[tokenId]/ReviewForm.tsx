"use client";

/**
 * The verified-review form on the agent card.
 *
 * What the user signs, and why they can trust the gate they are passing:
 * personal_sign over a canonical message binding THIS agent, THIS job, THIS
 * comment text and THIS timestamp (src/lib/review-message.ts builds it, the
 * server rebuilds it independently from the submitted fields - a signature
 * cannot be reused for different text). The server then reads the job on
 * chain and refuses unless it reached Completed with the signer as client and
 * this agent as provider. The form never asks for trust; it states the gate.
 *
 * Direct EIP-1193 like HireAction (no provider tree, works with every
 * injected BSC wallet). ASCII-only source (Windows-1252 write hazard).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildReviewMessage, validateComment, COMMENT_MIN, COMMENT_MAX } from "@/lib/review-message";

type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

function ethereum(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as { ethereum?: Eip1193 }).ethereum ?? null;
}

/** Wallets sign what they are given as-is when it is not hex. */
function utf8ToHex(s: string): `0x${string}` {
  const bytes = new TextEncoder().encode(s);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

export function ReviewForm({ tokenId, agentName }: { tokenId: string; agentName?: string | null }) {
  const router = useRouter();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [mounted, setMounted] = useState(false);
  const [chainChoice, setChainChoice] = useState<56 | 97>(56);
  const [jobId, setJobId] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setMounted(true);
    const eth = ethereum();
    if (!eth) return;
    // Silent restore only - eth_accounts never prompts.
    eth.request({ method: "eth_accounts" })
      .then((accs) => { if (Array.isArray(accs) && accs.length) setAddress(accs[0] as `0x${string}`); })
      .catch(() => {});
  }, []);

  const connect = useCallback(async () => {
    const eth = ethereum();
    if (!eth) return;
    try {
      setError(null);
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress((accs[0] as `0x${string}`) ?? null);
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 140));
    }
  }, []);

  const submit = useCallback(async () => {
    const eth = ethereum();
    if (!eth || !address) return;
    setError(null);
    setDone(false);

    const id = jobId.trim();
    if (!/^\d+$/.test(id)) { setError("Enter the numeric job id from your completed hire."); return; }
    const checked = validateComment(comment);
    if (!checked.ok) { setError(checked.reason); return; }

    setBusy(true);
    try {
      const issuedAt = Math.floor(Date.now() / 1000);
      const message = buildReviewMessage({
        agentTokenId: tokenId, chainId: chainChoice, jobId: id, comment: checked.comment, issuedAt,
      });
      const signature = (await eth.request({
        method: "personal_sign",
        params: [utf8ToHex(message), address],
      })) as `0x${string}`;

      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenId, chainId: chainChoice, jobId: id, comment: checked.comment,
          reviewer: address, issuedAt, signature,
        }),
      });
      const body = (await res.json()) as { ok: boolean; reason?: string };
      if (!body.ok) {
        setError(body.reason ?? "the review was not accepted");
        return;
      }
      setDone(true);
      setComment("");
      setJobId("");
      // The card is server-rendered; refresh pulls the new review in.
      router.refresh();
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  }, [address, chainChoice, comment, jobId, router, tokenId]);

  if (!mounted) return null;

  if (!address) {
    return (
      /* whiteSpace normal: .cta is nowrap by default, and this label is
         long enough that at 360px the button ran past the card and was
         clipped by its overflow:hidden. */
      <button
        onClick={connect}
        className="cta"
        style={{ marginTop: 14, padding: "10px 16px", whiteSpace: "normal", maxWidth: "100%" }}
      >
        Connect the wallet that hired, to leave a review
      </button>
    );
  }

  return (
    <div className="mt-m" style={{ borderTop: "1px solid var(--ink-850)", paddingTop: 14 }}>
      <p className="xs" style={{ margin: "0 0 10px" }}>
        <strong>Leave a verified review{agentName ? ` of ${agentName}` : ""}</strong>{" "}
        <span className="t-4">
          - only the wallet that was the client of a Completed APEX job with this agent as
          provider can post. Your wallet signature is checked against the job on chain.
        </span>
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label className="xs t-4" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Chain the job ran on
          <select
            value={chainChoice}
            onChange={(e) => setChainChoice(Number(e.target.value) as 56 | 97)}
            style={{
              background: "var(--ink-850)", color: "inherit", border: "none",
              borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem",
            }}
          >
            <option value={56}>BSC mainnet</option>
            <option value={97}>BSC testnet</option>
          </select>
        </label>
        <input
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          placeholder="APEX job id (e.g. 609)"
          inputMode="numeric"
          className="num"
          style={{
            flex: "1 1 120px", background: "var(--ink-850)", color: "inherit", border: "none",
            borderRadius: 6, padding: "6px 10px", fontSize: "0.8rem",
          }}
        />
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={`Did it do what the brief said? ${COMMENT_MIN}-${COMMENT_MAX} characters. This is published as evidence, not a score.`}
        rows={3}
        style={{
          width: "100%", marginTop: 8, background: "var(--ink-850)", color: "inherit",
          border: "none", borderRadius: 6, padding: "8px 10px", fontSize: "0.85rem",
          fontFamily: "inherit", resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={submit} disabled={busy || done} className="cta" style={{ padding: "10px 16px" }}>
          {busy ? "Check your wallet to sign..." : done ? "Review published" : "Sign and publish review"}
        </button>
        <span className="xs t-4 num">
          {comment.trim().length} / {COMMENT_MAX}
        </span>
      </div>
      {error && (
        <div className="notice mt-s" data-tone="fail">
          <span className="xs">{error}</span>
        </div>
      )}
      {done && (
        <p className="xs" style={{ marginTop: 10, color: "var(--pass)", marginBottom: 0 }}>
          Published - anchored to your completed job, readable by anyone, deletable by no one.
        </p>
      )}
    </div>
  );
}
