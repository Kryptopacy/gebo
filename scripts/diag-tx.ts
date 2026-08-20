/**
 * Diagnose the relay faucet transaction: did it land, and who actually received?
 */
import "dotenv/config";
import { createPublicClient, http, formatEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const TX = (process.argv[2] ?? "") as `0x${string}`;
if (!TX) throw new Error("usage: tsx scripts/diag-tx.ts <txHash>");

const RPCS = [
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
  "https://data-seed-prebsc-2-s1.bnbchain.org:8545",
  "https://bsc-testnet-rpc.publicnode.com",
  "https://bsc-testnet.public.blastapi.io",
];

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as `0x${string}`;
const me = privateKeyToAccount(pk).address;
console.log(`\n  my EOA : ${me}`);
console.log(`  tx     : ${TX}\n`);

for (const url of RPCS) {
  const pub = createPublicClient({ chain: bscTestnet, transport: http(url, { timeout: 15_000 }) });
  process.stdout.write(`  ${url}\n`);
  try {
    const block = await pub.getBlockNumber();
    const bal = await pub.getBalance({ address: me });
    process.stdout.write(`     head=${block}  myBalance=${formatEther(bal)} tBNB\n`);
    try {
      const tx = await pub.getTransaction({ hash: TX });
      process.stdout.write(`     tx found: from=${tx.from}\n`);
      process.stdout.write(`               to=${tx.to}\n`);
      process.stdout.write(`               value=${formatEther(tx.value)} tBNB  block=${tx.blockNumber}\n`);
      const rcpt = await pub.getTransactionReceipt({ hash: TX });
      process.stdout.write(`     receipt: status=${rcpt.status}  gasUsed=${rcpt.gasUsed}  logs=${rcpt.logs.length}\n`);
      if (tx.to && tx.to.toLowerCase() !== me.toLowerCase()) {
        const otherBal = await pub.getBalance({ address: tx.to });
        process.stdout.write(`     NOTE: recipient != my EOA. recipient balance=${formatEther(otherBal)} tBNB\n`);
      }
    } catch (e: any) {
      process.stdout.write(`     tx NOT found here: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 120)}\n`);
    }
  } catch (e: any) {
    process.stdout.write(`     RPC error: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 120)}\n`);
  }
  process.stdout.write("\n");
}
