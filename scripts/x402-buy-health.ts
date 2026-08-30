/**
 * End-to-end x402 test: an Altana session key with an $U spend cap BUYS the
 * HealthGuard paid endpoint. This is the Altana track's whole story in one
 * run - a scoped key paying per-call inside its limits, settlement on-chain,
 * the seller answering with the receipt.
 *
 * Prereq: npx tsx scripts/claim-testnet-u.ts has put $U in the demo wallet,
 * and the app is running (next start) with DEMO_OWNER_PRIVATE_KEY set.
 *
 * Usage: BASE=http://localhost:3100 npx tsx scripts/x402-buy-health.ts
 */
import "dotenv/config";
import { createClient, BNB_TESTNET, signerFromPrivateKey, PERMIT2_ADDRESS } from "@altananetwork/sdk";
import { formatUnits, parseAbi, createPublicClient, http } from "viem";

const U_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565";
const BASE = process.env.BASE ?? "http://localhost:3100";
const TARGET = "0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055"; // the address we ask about
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

  // 1. The unpaid request must produce the 402 challenge, not a free answer.
  //    The challenge also names the payTo the merchant configured - kept for
  //    the settlement check at the end, which fails loudly when earnings land
  //    anywhere else (a buyer==payTo misconfiguration is a self-transfer that
  //    leaves every balance unchanged and used to read as "paid 0" success).
  const url = `${BASE}/api/agent/health/paid?address=${TARGET}`;
  const bare = await fetch(url);
  console.log(`unpaid request: HTTP ${bare.status}`);
  let payTo: string | null = null;
  if (bare.status === 402) {
    const body = (await bare.json()) as {
      accepts?: { payTo?: string; amount?: string }[];
      error?: string;
    };
    payTo = body.accepts?.[0]?.payTo ?? null;
    console.log(`challenge payTo: ${payTo ?? "(not advertised)"}`);
    console.log(`challenge: ${JSON.stringify(body).slice(0, 220)}...`);
  } else {
    console.log(`expected 402, got ${bare.status}: ${(await bare.text()).slice(0, 140)}`);
  }

  // 2. Grant a session that may spend at most 1 $U/day. The purchase costs
  //    0.01 $U, so the cap holds with two orders of magnitude of headroom.
  console.log("granting session (spend cap 1 $U/day, target $U token)...");
  const session = await client.grantSession({
    wallet,
    signer,
    chainId: 97,
    permissions: {
      calls: [{ to: U_TOKEN }],
      spend: [{ limit: 1_000_000_000_000_000_000n, period: "day", token: U_TOKEN }],
    },
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });
  console.log(`session key ${session.publicKey.slice(0, 14)}... on wallet ${session.walletAddress}`);

  // 3. One-time provisioning for the permit2-exact rail (the rail Altana
  //    smart-account buyers sign; eip3009 rejects session signatures):
  //    approve Permit2 to move $U, then authorize Permit2 as this session's
  //    ERC-1271 signature checker.
  console.log("provisioning permit2 rail (approve + signature checker)...");
  await client.approveTokenForPermit2({ wallet, signer, token: U_TOKEN as `0x${string}`, chainId: 97 });
  await client.approveSignatureChecker({ wallet, signer, session, checker: PERMIT2_ADDRESS, chainId: 97 });
  console.log(`permit2 approved, checker ${PERMIT2_ADDRESS} authorised for the session`);

  const uBefore = await pub.readContract({ address: U_TOKEN, abi: ERC20, functionName: "balanceOf", args: [wallet.address] });
  const payToBefore = payTo
    ? await pub.readContract({ address: U_TOKEN, abi: ERC20, functionName: "balanceOf", args: [payTo as `0x${string}`] })
    : null;

  // 3. Buy through the SDK's x402 client: signs the eip3009 authorization
  //    with the session key, replays it, and settles on-chain.
  console.log("buying via fetchWithX402 (session key signs)...");
  const res = await client.fetchWithX402({ session, url });
  const text = await res.text();
  console.log(`paid request: HTTP ${res.status}`);
  try {
    const body = JSON.parse(text);
    if (body.paid) console.log(`receipt: ${JSON.stringify(body.paid)}`);
    if (body.answer) console.log(`answer: HF=${body.answer.healthFactor} (${body.answer.verdict}) at block ${body.answer.blockNumber}`);
    if (body.error) console.log(`error field: ${body.error}`);
  } catch {
    console.log(text.slice(0, 300));
  }

  const uAfter = await pub.readContract({ address: U_TOKEN, abi: ERC20, functionName: "balanceOf", args: [wallet.address] });
  const payToAfter = payTo
    ? await pub.readContract({ address: U_TOKEN, abi: ERC20, functionName: "balanceOf", args: [payTo as `0x${string}`] })
    : null;
  const paidByBuyer = uBefore - uAfter;
  const receivedByPayTo = payToAfter !== null && payToBefore !== null ? payToAfter - payToBefore : null;
  const price = 10_000_000_000_000_000n;
  console.log(`wallet $U: ${formatUnits(uBefore, 18)} -> ${formatUnits(uAfter, 18)} (paid ${formatUnits(paidByBuyer, 18)})`);
  if (payTo) console.log(`payTo  $U: ${formatUnits(payToBefore!, 18)} -> ${formatUnits(payToAfter!, 18)} (received ${formatUnits(receivedByPayTo!, 18)})`);

  // The settlement must have moved the price to the advertised payTo. A buyer
  // balance that did not fall, or a payTo that did not rise, means the payment
  // went in a circle (buyer == payTo) or nowhere - both are failures even
  // though the HTTP layer said 200 with a receipt.
  if (receivedByPayTo === null || receivedByPayTo < price) {
    console.error(
      `SETTLEMENT FAILED THE BALANCE CHECK: payTo ${payTo ?? "?"} received ` +
        `${receivedByPayTo === null ? "nothing (not advertised)" : formatUnits(receivedByPayTo, 18) + " $U"}, ` +
        `expected at least ${formatUnits(price, 18)}. If payTo equals the buyer, the merchant is ` +
        `misconfigured and the settlement was a self-transfer.`,
    );
    process.exit(1);
  }
  console.log("settlement verified on-chain: the advertised payTo received the price.");
}

main().catch((e) => { console.error("BUY FAILED:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
