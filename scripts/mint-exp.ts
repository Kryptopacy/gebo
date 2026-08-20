/**
 * Mint EXP fee tokens on BSC testnet so we can pay relay fees without tBNB.
 *
 * Background: Altana's relay faucet (`wallet_addFaucetFunds`) issues ERC-20
 * mints — calldata is mint(address,uint256), selector 0x40c10f19. Passing
 * tokenAddress = 0x0 (as the SDK's fundNative does) calls mint() on the zero
 * address, which no-ops and reports success. Passing a real token works.
 *
 * EXP is documented as a relay fee token:
 * https://docs.altana.network/concepts/networks/testnet
 */
import "dotenv/config";
import { createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { createPublicClient, http, formatEther, parseEther, erc20Abi } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const EXP = "0xa8071DA5e994cB8e3eB56CaD0FBB6ca424dD8dc0" as const;
const EXP2 = "0x61727778216127D0843A99A3e91e99C27e9f3BC7" as const;
const RELAY = "https://testnet-relay.altana.network";

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as `0x${string}`;
const eoa = privateKeyToAccount(pk).address;

const pub = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });

// Derive the smart-account address (counterfactual — no deploy, no gas).
const altana = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);
const wallet = await altana.createWallet({ signer });

console.log(`\n  EOA            : ${eoa}`);
console.log(`  Smart wallet   : ${wallet.address}`);
console.log(`  testnet KeyStore: ${BNB_TESTNET.keyStore}`);
console.log(`  relay          : ${BNB_TESTNET.relayUrl}\n`);

async function faucet(address: string, token: string, value: bigint) {
  const res = await fetch(RELAY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "wallet_addFaucetFunds",
      params: [{ address, chainId: 97, tokenAddress: token, value: `0x${value.toString(16)}` }],
    }),
  });
  return res.json() as Promise<any>;
}

async function bal(token: `0x${string}`, who: `0x${string}`) {
  try {
    return await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  } catch { return -1n; }
}

for (const [name, token] of [["EXP", EXP], ["EXP2", EXP2]] as const) {
  for (const [label, who] of [["smart wallet", wallet.address], ["EOA", eoa]] as const) {
    const before = await bal(token, who as `0x${string}`);
    const r = await faucet(who, token, parseEther("100"));
    const ok = r?.result?.transactionHash;
    if (ok) await pub.waitForTransactionReceipt({ hash: ok, timeout: 60_000 }).catch(() => null);
    const after = await bal(token, who as `0x${string}`);
    console.log(`  ${name} -> ${label.padEnd(13)} before=${before === -1n ? "n/a" : formatEther(before)}  after=${after === -1n ? "n/a" : formatEther(after)}  ${ok ? "tx ok" : JSON.stringify(r?.error ?? r).slice(0, 90)}`);
  }
}

console.log(`\n  native tBNB (wallet): ${formatEther(await pub.getBalance({ address: wallet.address }))}`);
console.log(`  native tBNB (EOA)   : ${formatEther(await pub.getBalance({ address: eoa }))}\n`);
