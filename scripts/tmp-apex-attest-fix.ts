// Correct APEX attestations recorded mid-lifecycle: the jobs were Submitted
// when recorded (outcome=partial, result says status=Submitted) and have
// since settled to Completed on-chain. The chain is the source of truth;
// record-apex-attestations.ts cannot fix these (on conflict do nothing), so
// this updates outcome and the result text, only for rows whose CURRENT
// on-chain status is Completed and whose recorded outcome understates it.
// Prints every row before touching it.
import "dotenv/config";
import postgres from "postgres";
import { createPublicClient, http, fallback, parseAbi, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";

const COMMERCE_ABI = parseAbi([
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
]);

const NETS = {
  56: {
    chain: bsc,
    rpcs: [process.env.BSC_MAINNET_RPC, "https://bsc-rpc.publicnode.com"],
    commerce: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6" as Address,
  },
  97: {
    chain: bscTestnet,
    rpcs: [process.env.BSC_TESTNET_RPC, "https://bsc-testnet-rpc.publicnode.com"],
    commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE" as Address,
  },
} as const;

const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

const rows = await sql`
  select id, chain_id, evidence_ref, outcome, result
  from attestations
  where evidence_ref like 'apex-%'
  order by id`;

let corrected = 0;
for (const r of rows) {
  const jobId = BigInt(r.evidence_ref.split("-")[1]);
  const cfg = NETS[r.chain_id as 56 | 97];
  const pub = createPublicClient({
    chain: cfg.chain,
    transport: fallback(cfg.rpcs.filter(Boolean).map((u) => http(u as string, { timeout: 30_000 }))),
  });
  const j = (await pub.readContract({
    address: cfg.commerce, abi: COMMERCE_ABI, functionName: "getJob", args: [jobId],
  })) as { status: number };
  const onChain = STATUS[Number(j.status)] ?? `unknown(${j.status})`;

  if (onChain !== "Completed" || r.outcome === "succeeded") {
    console.log(`  #${r.id} ${r.evidence_ref}: on-chain=${onChain}, recorded=${r.outcome} - no change`);
    continue;
  }

  console.log(`  #${r.id} ${r.evidence_ref}: on-chain=Completed, recorded=${r.outcome} -> correcting`);
  await sql`
    update attestations
    set outcome = 'succeeded',
        result = replace(${r.result}, 'status=Submitted', 'status=Completed')
    where id = ${r.id}`;
  corrected++;
}

console.log(`\n  ${corrected} attestation(s) corrected to match settled on-chain state.`);
await sql.end({ timeout: 5 });
