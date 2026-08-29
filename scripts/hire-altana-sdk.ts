/**
 * Hire an ERC-8183 agent using the Altana ERC-8183 SDK â€” the Altana track's
 * bonus, executed rather than described.
 *
 * One atomic relay intent (createJob -> registerJob -> setBudget -> approve ->
 * fund), batched and gas-handled by Altana's relay, signed by the demo owner
 * key. Zero budget by the same deliberate policy as scripts/hire-apex.ts: the
 * job traverses the identical state machine, and the report records cost as a
 * true zero rather than implying value moved.
 *
 * TESTNET (97): the demo wallet holds tBNB, and testnet counts for the track.
 * Pass --mainnet once the mainnet wallet is funded; nothing else changes.
 *
 * Usage: npx tsx scripts/hire-altana-sdk.ts [--provider 0x...] [--task "..."]
 */
import "dotenv/config";
import {
  createClient, BNB, BNB_TESTNET, signerFromPrivateKey,
  hireErc8183Agent, buildHireCalls, erc8183Addresses,
  getErc8183Job, type NetworkConfig,
} from "@altananetwork/sdk";
import { createPublicClient, http, parseAbi } from "viem";
import { findAgent } from "../src/lib/data.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

async function main() {
  const pk = process.env.DEMO_OWNER_PRIVATE_KEY;
  if (!pk) { console.error("DEMO_OWNER_PRIVATE_KEY not set"); process.exit(1); }

  const useMainnet = args.includes("--mainnet");
  const network: NetworkConfig = useMainnet ? BNB : BNB_TESTNET;
  const chainId = useMainnet ? 56 : 97;

  const client = createClient({ chains: [network] });
  const signer = signerFromPrivateKey(pk as `0x${string}`);
  const wallet = await client.createWallet({ signer });
  console.log(`hirer (Altana wallet): ${wallet.address} on chain ${chainId}`);

  // Provider defaults to the HealthGuard reference agent's owner so the task
  // below matches what that agent actually does.
  let provider = flag("provider");
  if (!provider) {
    const agent = await findAgent("259573");
    if (!agent?.owner_address) {
      console.error("Could not read token 259573's owner; pass --provider 0x...");
      process.exit(1);
    }
    provider = agent.owner_address;
    console.log(`provider: ${agent.name} (#259573) owner ${provider}`);
  }

  const task =
    flag("task") ??
    `Report the Venus lending health factor for ${wallet.address} on BNB Chain, ` +
    "with the collateral and debt it was computed from.";

  console.log(`task: ${task}`);
  console.log("submitting hire intent via Altana relay (single atomic batch)...");

  /**
   * Two SDK paths, tried in order.
   *
   * 1. hireErc8183Agent — the documented one-call buyer flow.
   * 2. client.execute(buildHireCalls(...)) — the same SDK's call builder
   *    driven through the same relay, with one address overridden.
   *
   * The override exists because the SDK registry's TESTNET policy
   * (0x4F4678D4...) reverts in registerJob with PolicyNotWhitelisted: the
   * testnet router accepts the 15-minute-window deployment (0xd6a42175...,
   * the policy every GEBO testnet hire has ever bound) but not the SDK's
   * 24-hour one yet. On mainnet the SDK set matches our verified addresses
   * exactly and path 1 is expected to work unchanged.
   */
  const POLICY_OVERRIDE: Record<number, `0x${string}`> = {
    97: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea",
  };

  let result: { jobId: bigint; expiredAt: bigint; status: string; transactionHash?: `0x${string}` };
  let hiredVia = "hireErc8183Agent";
  try {
    const r = await hireErc8183Agent(
      wallet,
      signer,
      { provider: provider as `0x${string}`, task, budget: 0n },
      { network },
    );
    result = r;
  } catch (err: unknown) {
    const details = String((err as { details?: string })?.details ?? "");
    if (!useMainnet && details === "0xc94463e3") {
      console.log("SDK registry policy not whitelisted on this router (PolicyNotWhitelisted);");
      console.log("retrying via client.execute with the router-whitelisted 15-minute policy...");
      hiredVia = "client.execute(buildHireCalls)";
      const addrs = { ...erc8183Addresses(97), policy: POLICY_OVERRIDE[97]! };
      const pub = createPublicClient({
        transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 30_000 }),
      });
      const counter = await pub.readContract({
        address: addrs.commerce, abi: parseAbi(["function jobCounter() view returns (uint256)"]), functionName: "jobCounter",
      });
      const window = await pub.readContract({
        address: addrs.policy, abi: parseAbi(["function disputeWindow() view returns (uint256)"]), functionName: "disputeWindow",
      });
      const calls = buildHireCalls({
        addresses: addrs,
        jobId: counter + 1n,
        provider: provider as `0x${string}`,
        description: task,
        budget: 0n,
        expiredAt: BigInt(Math.floor(Date.now() / 1000)) + window + 1800n,
      });
      const r = await client.execute({ wallet, signer, calls, chainId: 97 });
      result = {
        jobId: counter + 1n,
        expiredAt: 0n,
        status: r.status,
        transactionHash: r.transactionHash,
      };
    } else {
      throw err;
    }
  }

  console.log(`hired via: ${hiredVia}`);
  console.log(`jobId: ${result.jobId}`);
  if (result.expiredAt) console.log(`expiredAt: ${new Date(Number(result.expiredAt) * 1000).toISOString()}`);
  console.log(`status: ${result.status}`);
  if (result.transactionHash) console.log(`tx: ${result.transactionHash}`);
  if (result.transactionHash) console.log(`explorer: https://${useMainnet ? "" : "testnet."}bscscan.com/tx/${result.transactionHash}`);

  // Confirm on-chain the way a third party would, not by trusting the result.
  const job = await getErc8183Job(network, result.jobId);
  console.log(
    `on-chain check: job ${job.id} status=${job.statusName} client=${job.client} ` +
    `provider=${job.provider} budget=${job.budget} (${"0" === job.budget.toString() ? "zero, by design" : "non-zero"})`,
  );
  if (result.expiredAt === 0n) {
    console.log(`on-chain expiredAt: ${new Date(Number(job.expiredAt) * 1000).toISOString()}`);
  }

  console.log("\nThis is a live ERC-8183 hire through the Altana SDK: a relay");
  console.log("intent, the SDK's call builder, zero budget, escrow state machine intact.");
}

main().catch((e) => {
  console.error("HIRE FAILED:", e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
