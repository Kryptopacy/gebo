/**
 * Second attempt at the Altana relay faucet, using porto's own RelayActions
 * encoder rather than hand-rolled JSON-RPC.
 */
import "dotenv/config";
import { addFaucetFunds } from "porto/viem/RelayActions";
import { createClient, createPublicClient, http, formatEther, parseEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const pk = process.env.DEMO_OWNER_PRIVATE_KEY as `0x${string}`;
const address = privateKeyToAccount(pk).address;

const pub = createPublicClient({
  chain: bscTestnet,
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});

const relay = createClient({
  chain: bscTestnet,
  transport: http("https://testnet-relay.altana.network", { timeout: 30_000 }),
});

console.log(`\n  wallet: ${address}`);
console.log(`  before: ${formatEther(await pub.getBalance({ address }))} tBNB\n`);

for (const amount of [parseEther("0.05"), parseEther("0.01")]) {
  console.log(`  addFaucetFunds(value=${formatEther(amount)})`);
  try {
    const res: any = await addFaucetFunds(relay, {
      address,
      tokenAddress: NATIVE,
      value: amount,
    } as any);
    console.log(`     -> ${JSON.stringify(res).slice(0, 300)}`);

    if (res?.transactionHash) {
      const rcpt = await pub
        .waitForTransactionReceipt({ hash: res.transactionHash, timeout: 60_000 })
        .catch((e: any) => ({ status: "timeout", err: String(e?.shortMessage ?? e).slice(0, 80) } as any));
      const tx = await pub.getTransaction({ hash: res.transactionHash }).catch(() => null);
      console.log(`     receipt status=${(rcpt as any).status}`);
      if (tx) console.log(`     tx to=${tx.to}  value=${formatEther(tx.value)}  input=${(tx.input ?? "0x").slice(0, 42)}`);
    }
  } catch (e: any) {
    console.log(`     threw: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 300)}`);
  }

  const bal = await pub.getBalance({ address });
  console.log(`     balance: ${formatEther(bal)} tBNB\n`);
  if (bal > 0n) { console.log("  FUNDED.\n"); process.exit(0); }
}

console.log("  Relay faucet is not delivering native tBNB to a plain EOA on chain 97.");
console.log("  Conclusion: treat as unavailable; proceed with fund-free work.\n");
