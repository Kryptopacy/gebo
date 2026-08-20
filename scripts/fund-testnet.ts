/**
 * Fund the testnet demo wallet from Altana's relay-side faucet.
 *
 * Why this exists: the public BSC faucet (testnet.bnbchain.org/faucet-smart)
 * gates on holding a minimum MAINNET balance. Altana's relay exposes
 * `wallet_addFaucetFunds` on test networks, which has no such gate.
 *
 * Discovered via: @altananetwork/sdk exports fundNative() -> porto
 * RelayActions.addFaucetFunds() -> JSON-RPC `wallet_addFaucetFunds`.
 */
import "dotenv/config";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RELAYS = [
  "https://testnet-relay.altana.network",
  "https://relay.altana.network",
];
const NATIVE = "0x0000000000000000000000000000000000000000";
const TARGET = parseEther("0.05");

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error("DEMO_OWNER_PRIVATE_KEY missing — run npm run keys:gen");
const address = privateKeyToAccount(pk).address;

const rpc = process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const pub = createPublicClient({ chain: bscTestnet, transport: http(rpc) });

async function balance() {
  return pub.getBalance({ address });
}

async function tryFaucet(relay: string, value: bigint) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "wallet_addFaucetFunds",
    params: [
      {
        address,
        chainId: bscTestnet.id,
        tokenAddress: NATIVE,
        value: `0x${value.toString(16)}`,
      },
    ],
  };
  const res = await fetch(relay, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json };
}

console.log(`\n  target wallet : ${address}`);
console.log(`  chain         : BSC testnet (97)`);
console.log(`  rpc           : ${rpc}`);

let bal = await balance();
console.log(`  balance before: ${formatEther(bal)} tBNB\n`);

if (bal >= TARGET) {
  console.log("  Already funded. Nothing to do.\n");
  process.exit(0);
}

for (const relay of RELAYS) {
  console.log(`  -> POST ${relay}  wallet_addFaucetFunds`);
  try {
    const { status, json } = await tryFaucet(relay, TARGET);
    console.log(`     HTTP ${status}`);
    console.log(`     ${JSON.stringify(json).slice(0, 500)}`);
    if (json?.result) {
      console.log("\n     Faucet accepted. Waiting for balance...");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        bal = await balance();
        if (bal > 0n) break;
      }
      console.log(`     balance now: ${formatEther(bal)} tBNB`);
      if (bal > 0n) { console.log("\n  FUNDED.\n"); process.exit(0); }
    }
  } catch (e: any) {
    console.log(`     threw: ${e?.message ?? e}`);
  }
  console.log("");
}

bal = await balance();
console.log(`  final balance: ${formatEther(bal)} tBNB`);
console.log(bal > 0n ? "\n  FUNDED.\n" : "\n  Relay faucet did not fund. Fallback options needed.\n");
