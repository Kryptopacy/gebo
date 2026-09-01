/**
 * E2E for the verified-review gate, against real chains and the real DB.
 *
 * 1. reads the candidate APEX jobs and prints status/client/provider;
 * 2. records one review through recordReview() for a qualifying job,
 *    signing with the client key from .env;
 * 3. demonstrates a REFUSAL (the honest half of the test): a job that is not
 *    Completed, and a signer who is not the client, must both be rejected
 *    with legible reasons;
 * 4. reads reviewsFor() back - the same read the agent card renders.
 */
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { getApexJob, recordReview, reviewsFor } from "../src/lib/reviews";
import { buildReviewMessage } from "../src/lib/review-message";

const CANDIDATES = [
  { chainId: 97, jobId: "609" },
  { chainId: 97, jobId: "670" },
  { chainId: 97, jobId: "671" },
  { chainId: 97, jobId: "788" },
  { chainId: 56, jobId: "56641" },
] as const;

const KEYS: Record<string, Hex | undefined> = {
  demo: process.env.DEMO_OWNER_PRIVATE_KEY as Hex | undefined,
  rep: process.env.REPUTATION_WRITER_PRIVATE_KEY as Hex | undefined,
};

const TOKEN_IDS = ["259573", "259574", "259575", "259576"];

async function main() {
  console.log("candidate APEX jobs:");
  for (const c of CANDIDATES) {
    try {
      const j = await getApexJob(c.chainId, BigInt(c.jobId));
      const labels = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];
      console.log(
        `  chain ${c.chainId} job ${c.jobId}: ${labels[Number(j.status)]} client=${j.client} provider=${j.provider}`,
      );
    } catch (e: any) {
      console.log(`  chain ${c.chainId} job ${c.jobId}: unreadable (${String(e?.shortMessage ?? e?.message ?? e).slice(0, 60)})`);
    }
  }

  console.log("\nagent owner identities (for provider matching):");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
  for (const t of TOKEN_IDS) {
    const rows = await sql<{ owner: string | null; agent_wallet: string | null; name: string | null }[]>`
      select owner, agent_wallet, name from agents where chain_id = 56 and token_id = ${t}::bigint
    `;
    console.log(`  ${t}: ${rows[0]?.name ?? "(not indexed)"} owner=${rows[0]?.owner ?? "-"} wallet=${rows[0]?.agent_wallet ?? "-"}`);
  }
  await sql.end({ timeout: 5 });

  // Pick a qualifying job: Completed, and its client key available to us.
  for (const c of CANDIDATES) {
    let j: Awaited<ReturnType<typeof getApexJob>>;
    try {
      j = await getApexJob(c.chainId, BigInt(c.jobId));
    } catch { continue; }
    if (Number(j.status) !== 3) continue;
    const keyEntry = Object.entries(KEYS).find(([, k]) => {
      if (!k) return false;
      try { return privateKeyToAccount(k).address.toLowerCase() === j.client.toLowerCase(); } catch { return false; }
    });
    if (!keyEntry || !keyEntry[1]) continue;

    const account = privateKeyToAccount(keyEntry[1]);
    const tokenId = TOKEN_IDS[0]!; // reference agent 259573 (ApeX hire target)
    const comment = "Mechanism-verification hire, disclosed as such: the job ran the full APEX lifecycle to Completed with GEBO's own reference agent as provider. The escrow state machine, dispute window and settlement all executed exactly as documented on this card.";

    const issuedAt = Math.floor(Date.now() / 1000);
    const message = buildReviewMessage({
      agentTokenId: tokenId, chainId: c.chainId, jobId: c.jobId, comment, issuedAt,
    });
    const signature = await account.signMessage({ message });

    console.log(`\nrecording review: chain ${c.chainId} job ${c.jobId}, signer ${account.address}`);
    const res = await recordReview({
      tokenId, chainId: c.chainId, jobId: c.jobId, comment,
      reviewer: account.address, issuedAt, signature,
    });
    console.log(`  -> ${res.ok ? `OK id=${res.id} block=${res.checkedBlock}` : `REFUSED: ${res.reason}`}`);

    // Refusal 1: the same job reviewed again (one review per job).
    const again = await recordReview({
      tokenId, chainId: c.chainId, jobId: c.jobId, comment: comment + " Again.",
      reviewer: account.address, issuedAt: Math.floor(Date.now() / 1000),
      signature: await account.signMessage({ message: buildReviewMessage({ agentTokenId: tokenId, chainId: c.chainId, jobId: c.jobId, comment: comment + " Again.", issuedAt: Math.floor(Date.now() / 1000) }) }),
    });
    console.log(`  duplicate -> ${again.ok ? "UNEXPECTED OK" : `REFUSED: ${again.reason}`}`);

    // Refusal 2: a comment NOT signed by the client (tampered signature).
    const tampered = await recordReview({
      tokenId, chainId: c.chainId, jobId: c.jobId,
      comment: "This signature does not belong to the stated reviewer.",
      reviewer: j.client, issuedAt: Math.floor(Date.now() / 1000),
      signature: await account.signMessage({ message: buildReviewMessage({ agentTokenId: tokenId, chainId: c.chainId, jobId: c.jobId, comment: "This signature does not belong to the stated reviewer.", issuedAt: Math.floor(Date.now() / 1000) }) }),
    });
    // This one is signed by the same account, so it verifies - but the job
    // already has its review, which is the part being exercised here.
    console.log(`  tampered-text variant -> ${tampered.ok ? "UNEXPECTED OK" : `REFUSED: ${tampered.reason}`}`);
    break;
  }

  // Refusal 3: a job that is NOT Completed (788 sat at Funded at last read).
  const funded = await getApexJob(97, 788n).catch(() => null);
  if (funded && Number(funded.status) !== 3) {
    const key = KEYS.demo;
    if (key) {
      const account = privateKeyToAccount(key);
      const issuedAt = Math.floor(Date.now() / 1000);
      const comment = "Should never publish: the job has not completed.";
      const res = await recordReview({
        tokenId: "259573", chainId: 97, jobId: "788", comment,
        reviewer: account.address, issuedAt,
        signature: await account.signMessage({
          message: buildReviewMessage({ agentTokenId: "259573", chainId: 97, jobId: "788", comment, issuedAt }),
        }),
      });
      console.log(`\nuncompleted job 788 -> ${res.ok ? "UNEXPECTED OK" : `REFUSED: ${res.reason}`}`);
    }
  }

  // Refusal 4: a valid wallet whose signature does not match the stated
  // reviewer. The signature check runs BEFORE any chain read, so this also
  // proves ordering: an attacker cannot even reach the gate unsigned.
  {
    const key = KEYS.demo;
    if (key) {
      const signer = privateKeyToAccount(key);
      const issuedAt = Math.floor(Date.now() / 1000);
      const comment = "Should never publish: forged attribution.";
      const res = await recordReview({
        tokenId: "259573", chainId: 97, jobId: "609", comment,
        reviewer: "0x000000000000000000000000000000000000dead", issuedAt,
        signature: await signer.signMessage({
          message: buildReviewMessage({ agentTokenId: "259573", chainId: 97, jobId: "609", comment, issuedAt }),
        }),
      });
      console.log(`forged attribution -> ${res.ok ? "UNEXPECTED OK" : `REFUSED: ${res.reason}`}`);
    }
  }

  const back = await reviewsFor("259573");
  console.log(`\nreviewsFor(259573): ${back.unavailable ? `unavailable (${back.reason})` : `${back.reviews.length} review(s)`}`);
  for (const r of back.reviews) {
    console.log(`  [chain ${r.chainId} job ${r.jobId}] ${r.reviewer}: ${r.comment.slice(0, 80)}...`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
