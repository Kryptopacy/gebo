/**
 * Claim testnet $U from the public faucet into the Altana demo wallet.
 *
 * The faucet (0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3) pays 10 $U to the
 * caller once per address every 30 minutes. Called through the Altana relay,
 * the smart account is msg.sender, so the payout lands in the wallet that
 * will act as the x402 buyer - which is the point: eip3009 payments pull $U
 * from the payer's balance.
 *
 * Usage: npx tsx scripts/claim-testnet-u.ts
 * Docs: https://docs.altana.network/sdk/erc8183#get-testnet-u
 */
import "dotenv/config";
import { createClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { encodeFunctionData, createPublicClient, http, formatUnits, parseAbi } from "viem";

const U_FAUCET = "0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3";
const U_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565";
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

async function main() {
  const pk = process.env.DEMO_OWNER_PRIVATE_KEY;
  if (!pk) { console.error("DEMO_OWNER_PRIVATE_KEY not set"); process.exit(1); }

  const client = createClient({ chains: [BNB_TESTNET] });
  const signer = signerFromPrivateKey(pk as `0x${string}`);
  const wallet = await client.createWallet({ signer });
  const pub = createPublicClient({
    transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 30_000 }),
  });

  const before = await pub.readContract({ address: U_TOKEN, abi: ERC20, functionName: "balanceOf", args: [wallet.address] });
  console.log(`wallet ${wallet.address} $U before: ${formatUnits(before, 18)}`);

  console.log("claiming from faucet via relay (requestTokens)...");
  const res = await client.execute({
    wallet,
    signer,
    chainId: 97,
    calls: [{
      to: U_FAUCET,
      data: encodeFunctionData({
        abi: [{ name: "requestTokens", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }],
        functionName: "requestTokens",
      }),
    }],
  });
  console.log(`status: ${res.status}${res.transactionHash ? ` tx: ${res.transactionHash}` : ""}`);

  // Wait for the balance to reflect the payout, then report the delta.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const now = await pub.readContract({ address: U_TOKEN, abi: ERC20, functionName: "balanceOf", args: [wallet.address] });
    if (now > before) {
      console.log(`$U after: ${formatUnits(now, 18)} (+${formatUnits(now - before, 18)})`);
      console.log(`explorer: https://testnet.bscscan.com/tx/${res.transactionHash}`);
      return;
    }
  }
  console.log("balance unchanged after 60s - the faucet may be on its 30-minute cooldown for this address; retry later.");
}

main().catch((e) => { console.error("CLAIM FAILED:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
