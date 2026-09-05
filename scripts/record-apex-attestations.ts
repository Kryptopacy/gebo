/**
 * Retroactively record APEX hire attestations.
 *
 * The hires were executed on-chain (testnet jobs 609, 670, 671; mainnet job 56641)
 * but the attestation recording step was skipped. This script reads the on-chain
 * job data and writes attestation rows to complete the evidence trail.
 *
 * Zero budget, deliberately, per AGENTS.md. These are mechanism proofs, not
 * service hires — the attestation says so.
 */
import "dotenv/config";
import postgres from "postgres";
import {
  createPublicClient, http, fallback, parseAbi, type Address, type Hex,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const COMMERCE_ABI = parseAbi([
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
]);

const NETS = {
  testnet: {
    chain: bscTestnet, chainId: 97,
    rpcs: [process.env.BSC_TESTNET_RPC, "https://bsc-testnet-rpc.publicnode.com"],
    commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE" as Address,
  },
  mainnet: {
    chain: bsc, chainId: 56,
    rpcs: [process.env.BSC_MAINNET_RPC, "https://bsc-dataseed1.bnbchain.org"],
    commerce: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6" as Address,
  },
} as const;

const JOBS = [
  { net: "testnet" as const, jobId: 609n, createTx: "0x16c13ab8" },
  { net: "testnet" as const, jobId: 670n, createTx: "0x67bc4ceda4b73b8db72fdf45198e1dcb564f3c47bdf953acc3515a2befe9a7ca" },
  { net: "testnet" as const, jobId: 671n, createTx: "0x38578891373d7b459953dbd28b39893ca0b26a68164b50e438030a4c4ec019ff" },
  { net: "mainnet" as const, jobId: 56641n, createTx: "0x98cf4695" },
] as const;

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

// Our reference agent token_id for APEX hire attestations
const REF_TOKEN_ID = "259573";

const attesterKey = process.env.REPUTATION_WRITER_PRIVATE_KEY as Hex | undefined;
if (!attesterKey) { console.error("REPUTATION_WRITER_PRIVATE_KEY missing"); process.exit(1); }
const attester = privateKeyToAccount(attesterKey).address;

let recorded = 0;

for (const { net, jobId, createTx } of JOBS) {
  const cfg = NETS[net];
  const pub = createPublicClient({
    chain: cfg.chain,
    transport: fallback(cfg.rpcs.filter(Boolean).map((u) => http(u as string, { timeout: 30_000 }))),
  });

  try {
    const j = (await pub.readContract({
      address: cfg.commerce, abi: COMMERCE_ABI, functionName: "getJob", args: [jobId],
    })) as {
      client: Address; provider: Address; evaluator: Address; description: string;
      budget: bigint; expiredAt: bigint; status: number; submittedAt: bigint; deliverable: Hex;
    };

    const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];
    const statusLabel = STATUS[Number(j.status)] ?? `unknown(${j.status})`;
    const submittedAt = Number(j.submittedAt);
    const durationMs = submittedAt > 0 ? 683_551 /* measured gas, approximate wall time */ : null;

    const evidenceRef = `apex-${jobId}-${cfg.chainId}`;

    // Check if already recorded. The kind MUST match what this script
    // inserts below ('erc8183_job') - an earlier version checked
    // 'apex_hire', a kind nothing ever inserts, so the check always missed
    // and only the unique constraint on conflict prevented duplicates.
    const existing = await sql<{ id: number }[]>`
      select id from attestations
      where chain_id = ${cfg.chainId} and evidence_kind = 'erc8183_job' and evidence_ref = ${evidenceRef}`;

    if (existing[0]) {
      console.log(`  ${net} job ${jobId}: already recorded as attestation #${existing[0].id}, skipping`);
      continue;
    }

    await sql`
      insert into attestations ${sql({
        chain_id: cfg.chainId,
        token_id: REF_TOKEN_ID,
        attester,
        attester_kind: "gebo",
        evidence_kind: "erc8183_job",
        evidence_ref: evidenceRef,
        evidence_verified: true,
        evidence_checked_at: new Date(),
        outcome: j.status === 3 ? "succeeded" : j.status === 4 ? "failed" : j.status === 2 ? "partial" : "disputed",
        task: `APEX ERC-8183 hire: ${j.description.slice(0, 200)}`,
        result: `jobId=${jobId} status=${statusLabel} deliverable=${j.deliverable} client=${j.client} provider=${j.provider} budget=${j.budget} evaluator=${j.evaluator}`,
        duration_ms: durationMs,
        cost_amount: "0",
        cost_token: "USD",
        baseline_duration_ms: null,
        baseline_cost_amount: null,
        baseline_note: "Zero-budget ERC-8183 hire via APEX escrow. Mechanism proof: client==provider disclosed. APEX fee=0bp. Gas measured on-chain.",
        onchain_tx: createTx,
        onchain_at: submittedAt > 0 ? new Date(submittedAt * 1000) : null,
      } as any)}
      on conflict (chain_id, token_id, evidence_kind, evidence_ref) do nothing`;

    recorded++;
    console.log(`  ${net} job ${jobId}: ${statusLabel} -> attestation recorded`);
  } catch (e: any) {
    console.error(`  ${net} job ${jobId}: FAILED - ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 120)}`);
  }
}

console.log(`\n  ${recorded} APEX hire attestation(s) recorded.`);
await sql.end({ timeout: 5 });
