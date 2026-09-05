// Read-only: compare each recorded APEX attestation's outcome with the
// job's CURRENT on-chain status, to find rows recorded mid-lifecycle that
// now understate a settled result.
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
  const agree =
    (onChain === "Completed" && r.outcome === "succeeded") ||
    (onChain === "Rejected" && r.outcome === "failed");
  console.log(
    `  #${r.id} ${r.evidence_ref}  on-chain=${onChain}  recorded=${r.outcome}  ${agree ? "ok" : "STALE"}`
  );
  if (!agree) {
    console.log(`      result field: ${r.result.slice(0, 120)}`);
  }
}

await sql.end({ timeout: 5 });
