/**
 * Hire an agent through APEX (ERC-8183) escrow, on chain, at zero budget.
 *
 * The Agent Advantage Report needs real hires, and this ecosystem's verified agents
 * do not answer questions - they expose `negotiate` and `notify_funded`, which are
 * commerce verbs. The hire IS the task. So this drives the kernel state machine and
 * records what it cost, measured rather than estimated.
 *
 * ZERO BUDGET, DELIBERATELY. Proving that escrow custodies funds would prove BNB
 * Chain's property, not ours, and it conflicts with invariant 7: we route through
 * APEX precisely so we are not the trusted party. A zero-budget job traverses the
 * identical state machine - Open, Funded, Submitted, Completed - and only the two
 * safeTransfer calls are skipped. setBudget(jobId, 0) is still required, because
 * fund reverts on !jobHasBudget[jobId].
 *
 * THE DISPUTE WINDOW SHAPES EVERYTHING, and it differs by two orders of magnitude:
 *
 *   mainnet  604,800s = 7 days      submit today or settlement cannot happen
 *   testnet      900s = 15 minutes  full lifecycle in one sitting
 *
 * The e2e suite settles by fast-forwarding the chain. On a real network we wait. So
 * this splits into stages: `prepare` drives createJob through submit, `settle`
 * finishes once the window has passed, and `status` reports where a job stands.
 *
 * CLIENT AND PROVIDER ARE THE SAME KEY in this first run, which the APEX e2e suite
 * also does for one-key testnet setups. That proves the mechanism, not a
 * third-party hire, and the recorded attestation says so rather than implying
 * otherwise. A genuine counterparty arrives with the seeded reference agent.
 *
 * Run: npx tsx scripts/hire-apex.ts --chain testnet --stage prepare
 *      npx tsx scripts/hire-apex.ts --chain testnet --stage settle --job 609
 *      npx tsx scripts/hire-apex.ts --chain mainnet --stage prepare
 */
import "dotenv/config";
import {
  createPublicClient, createWalletClient, http, fallback, parseAbi, keccak256, toBytes,
  formatEther, type Address, type Hex,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const CHAIN = (arg("chain") ?? "testnet").toLowerCase();
const STAGE = (arg("stage") ?? "prepare").toLowerCase();
const JOB_ARG = arg("job");

/** Addresses from scripts/addresses.ts upstream, each verified to hold code. */
const NETS = {
  testnet: {
    label: "BSC testnet (97)",
    chain: bscTestnet,
    rpcs: [process.env.BSC_TESTNET_RPC, "https://bsc-testnet-rpc.publicnode.com"],
    commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE" as Address,
    router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address,
    policy: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as Address,
    explorer: "https://testnet.bscscan.com/tx/",
    gasLabel: "tBNB",
    key: process.env.DEMO_OWNER_PRIVATE_KEY,
  },
  mainnet: {
    label: "BSC mainnet (56)",
    chain: bsc,
    rpcs: [process.env.BSC_MAINNET_RPC, "https://bsc-dataseed1.bnbchain.org", "https://binance.llamarpc.com"],
    commerce: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6" as Address,
    router: "0x51895229E12F9876011789B04f8698af06cCD6DA" as Address,
    policy: "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5" as Address,
    explorer: "https://bscscan.com/tx/",
    gasLabel: "BNB",
    key: process.env.REPUTATION_WRITER_PRIVATE_KEY,
  },
} as const;

const NET = NETS[CHAIN as keyof typeof NETS];
if (!NET) { console.error(`\n  unknown --chain ${CHAIN}; use testnet or mainnet\n`); process.exit(1); }
if (!NET.key) { console.error(`\n  no private key configured for ${CHAIN}\n`); process.exit(1); }

/** Signatures taken from the upstream e2e flow, not inferred. */
const COMMERCE_ABI = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
  "function jobCounter() view returns (uint256)",
  "function paymentToken() view returns (address)",
  "function platformFeeBP() view returns (uint256)",
  /**
   * getJob returns a STRUCT, so the return type is a single tuple.
   *
   * Declared as eleven flat outputs first, which decodes garbage rather than
   * failing cleanly: viem read the tuple's head offset as a string length and
   * reported "1232148003192376361735529062095666145940953526053 is not in safe
   * integer range". An ABI mistake that looks like an arithmetic error.
   */
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
]);
const ROUTER_ABI = parseAbi([
  "function registerJob(uint256 jobId, address policy)",
  "function settle(uint256 jobId, bytes evidence)",
]);
const POLICY_ABI = parseAbi(["function disputeWindow() view returns (uint256)"]);

const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

const account = privateKeyToAccount(NET.key as Hex);
const transport = fallback(
  NET.rpcs.filter(Boolean).map((u) => http(u as string, { timeout: 30_000, retryCount: 2 })),
);
const pub = createPublicClient({ chain: NET.chain, transport });
const wallet = createWalletClient({ account, chain: NET.chain, transport });

let gasSpent = 0n;
const txs: { step: string; hash: Hex; gas: bigint }[] = [];

/** Send, wait, and record what it actually cost. Estimates are not evidence. */
async function send(step: string, hash: Hex) {
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  const cost = rc.gasUsed * (rc.effectiveGasPrice ?? 0n);
  gasSpent += cost;
  txs.push({ step, hash, gas: rc.gasUsed });
  console.log(`    ${step.padEnd(12)} ${rc.status}  gas ${rc.gasUsed.toLocaleString().padStart(9)}  ${NET.explorer}${hash}`);
  if (rc.status !== "success") throw new Error(`${step} reverted`);
  return rc;
}

async function showJob(jobId: bigint) {
  const j = (await pub.readContract({
    address: NET.commerce, abi: COMMERCE_ABI, functionName: "getJob", args: [jobId],
  })) as {
    client: Address; provider: Address; evaluator: Address; description: string;
    budget: bigint; expiredAt: bigint; status: number; submittedAt: bigint; deliverable: Hex;
  };
  console.log(`\n  JOB ${jobId}`);
  console.log(`    status       ${STATUS[Number(j.status)] ?? j.status}`);
  console.log(`    client       ${j.client}`);
  console.log(`    provider     ${j.provider}`);
  console.log(`    evaluator    ${j.evaluator}`);
  console.log(`    budget       ${j.budget}`);
  console.log(`    description  ${j.description}`);
  console.log(`    deliverable  ${j.deliverable}`);
  console.log(`    expiredAt    ${new Date(Number(j.expiredAt) * 1000).toISOString()}`);
  if (Number(j.submittedAt) > 0) {
    const win = await pub.readContract({ address: NET.policy, abi: POLICY_ABI, functionName: "disputeWindow" });
    const settleAt = Number(j.submittedAt) + Number(win);
    const now = Math.floor(Date.now() / 1000);
    console.log(`    submittedAt  ${new Date(Number(j.submittedAt) * 1000).toISOString()}`);
    console.log(`    settleable   ${new Date(settleAt * 1000).toISOString()}` +
      (now >= settleAt ? "   NOW" : `   in ${((settleAt - now) / 3600).toFixed(2)} hours`));
  }
  return { status: Number(j.status), submittedAt: Number(j.submittedAt) };
}

console.log(`\n  APEX HIRE - ${NET.label}`);
console.log(`  ${"=".repeat(66)}`);
console.log(`  signer     ${account.address}`);

const bal = await pub.getBalance({ address: account.address });
console.log(`  balance    ${Number(formatEther(bal)).toFixed(8)} ${NET.gasLabel}`);
if (bal === 0n) { console.error(`\n  no gas; refusing to start rather than half-run\n`); process.exit(1); }

const [feeBP, window] = await Promise.all([
  pub.readContract({ address: NET.commerce, abi: COMMERCE_ABI, functionName: "platformFeeBP" }),
  pub.readContract({ address: NET.policy, abi: POLICY_ABI, functionName: "disputeWindow" }),
]);
console.log(`  fee        ${feeBP} bp  (charged on budget at complete; ours is 0)`);
console.log(`  dispute    ${window}s = ${(Number(window) / 3600).toFixed(2)} hours\n`);

if (STAGE === "status") {
  if (!JOB_ARG) { console.error("  --job <id> required for status\n"); process.exit(1); }
  await showJob(BigInt(JOB_ARG));
  console.log("");
  process.exit(0);
}

if (STAGE === "settle") {
  if (!JOB_ARG) { console.error("  --job <id> required for settle\n"); process.exit(1); }
  const jobId = BigInt(JOB_ARG);
  const s = await showJob(jobId);

  /**
   * Already settled is a success, not an error.
   *
   * settle carries no sender check - anyone may call it - and on testnet a third
   * party settled job 609 within about a minute of its dispute window closing,
   * before we got there. That is worth stating plainly: permissionless settlement
   * is not merely permitted by the contract, it is actively performed on this
   * network, so a client who walks away still gets a terminal outcome.
   *
   * Reporting it as "settle would revert" made a working system look broken.
   */
  if (s.status === 3) {
    console.log(`\n  Already Completed, and not by us.`);
    console.log(`  settle is permissionless, so a third party closed this job once its`);
    console.log(`  dispute window elapsed. The full lifecycle finished without the client`);
    console.log(`  sending a sixth transaction.\n`);
    process.exit(0);
  }
  if (s.status === 4 || s.status === 5) {
    console.log(`\n  Terminal state ${STATUS[s.status]}; nothing left to settle.\n`);
    process.exit(0);
  }
  if (s.status !== 2) {
    console.error(`\n  job is ${STATUS[s.status]}, not Submitted; settle would revert\n`);
    process.exit(1);
  }
  const settleAt = s.submittedAt + Number(window);
  if (Math.floor(Date.now() / 1000) < settleAt) {
    console.error(`\n  dispute window has not closed; settle would revert. Wait until ${new Date(settleAt * 1000).toISOString()}\n`);
    process.exit(1);
  }
  console.log(`\n  SETTLING`);
  const h = await wallet.writeContract({ address: NET.router, abi: ROUTER_ABI, functionName: "settle", args: [jobId, "0x"] });
  await send("settle", h);
  await showJob(jobId);
  console.log(`\n  gas for settle: ${Number(formatEther(gasSpent)).toFixed(8)} ${NET.gasLabel}\n`);
  process.exit(0);
}

// ── prepare: createJob through submit ────────────────────────────────────────
const now = BigInt(Math.floor(Date.now() / 1000));
/**
 * Expiry must be more than 5 minutes out and at most 365 days. Chosen well beyond
 * the dispute window so the job cannot expire into a refund before it can settle -
 * on mainnet that means clearing 7 days with room to spare.
 */
const expiredAt = now + BigInt(Number(window) + 3 * 24 * 3600);
const description = `GEBO verification hire: health-factor check, zero budget (mechanism proof, client==provider)`;

console.log(`  PREPARE  createJob -> registerJob -> setBudget(0) -> fund(0) -> submit`);
console.log(`    provider   ${account.address}  (same key as client; disclosed)`);
console.log(`    expiredAt  ${new Date(Number(expiredAt) * 1000).toISOString()}\n`);

const createHash = await wallet.writeContract({
  address: NET.commerce, abi: COMMERCE_ABI, functionName: "createJob",
  args: [account.address, NET.router, expiredAt, description, NET.router],
});
await send("createJob", createHash);

const jobId = (await pub.readContract({
  address: NET.commerce, abi: COMMERCE_ABI, functionName: "jobCounter",
})) as bigint;
console.log(`    jobId      ${jobId}`);

await send("registerJob", await wallet.writeContract({
  address: NET.router, abi: ROUTER_ABI, functionName: "registerJob", args: [jobId, NET.policy],
}));

// Zero, and still a required call: fund reverts on !jobHasBudget[jobId].
await send("setBudget", await wallet.writeContract({
  address: NET.commerce, abi: COMMERCE_ABI, functionName: "setBudget", args: [jobId, 0n, "0x"],
}));

// No ERC-20 approve: with a zero budget there is nothing to transfer.
await send("fund", await wallet.writeContract({
  address: NET.commerce, abi: COMMERCE_ABI, functionName: "fund", args: [jobId, 0n, "0x"],
}));

const deliverable = keccak256(toBytes(`gebo-health-factor-${jobId}-${Date.now()}`));
await send("submit", await wallet.writeContract({
  address: NET.commerce, abi: COMMERCE_ABI, functionName: "submit", args: [jobId, deliverable, "0x"],
}));

const st = await showJob(jobId);

console.log(`\n  MEASURED COST  (not estimated)`);
for (const t of txs) console.log(`    ${t.step.padEnd(12)} ${t.gas.toLocaleString().padStart(9)} gas`);
console.log(`    ${"total".padEnd(12)} ${txs.reduce((n, t) => n + t.gas, 0n).toLocaleString().padStart(9)} gas` +
  `  = ${Number(formatEther(gasSpent)).toFixed(8)} ${NET.gasLabel}`);

const settleAt = st.submittedAt + Number(window);
console.log(`\n  NEXT`);
console.log(`    npx tsx scripts/hire-apex.ts --chain ${CHAIN} --stage settle --job ${jobId}`);
console.log(`    settleable from ${new Date(settleAt * 1000).toISOString()}`);
console.log(`    deliverable ${deliverable}\n`);
