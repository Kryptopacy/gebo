/**
 * Check the Altana demo wallet's tBNB balance on testnet: the regrant crons
 * depend on it, and nobody will top it up unattended. Read-only.
 */
import "dotenv/config";
import { createPublicClient, http, formatEther } from "viem";
import { bscTestnet } from "viem/chains";

const DEMO = "0x688Fe953e20225e0542ED11a11C708437e71d40e";
const rpc = process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com";
const pub = createPublicClient({ chain: bscTestnet, transport: http(rpc, { timeout: 30_000 }) });
const bal = await pub.getBalance({ address: DEMO });
console.log(`demo wallet ${DEMO}`);
console.log(`tBNB balance: ${formatEther(bal)}`);
// A regrant day is ~4 grant txs; a testnet grant tx costs well under 0.005
// tBNB. Print runway at a conservative 0.01 tBNB per grant tx.
const perDay = 0.04;
const days = Number(formatEther(bal)) / perDay;
console.log(`runway at ~${perDay} tBNB/day: ~${days.toFixed(0)} days`);
