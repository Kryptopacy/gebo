/**
 * The canonical shape from Altana's own DEX guide.
 *
 * My earlier attempts conflated two distinct things. The documented example is:
 *
 *   calls: [{ to: router }]                        // target contract, no signature
 *   spend: [{ limit, period, token: stablecoin }]  // the token that LEAVES the wallet
 *
 * I was passing WBNB as both the call target and the spend token, plus a
 * `signature` the guide does not use. If the validator derives "what is being
 * spent" from the value or transfer path rather than from the call target, then
 * capping the target contract's own token authorises nothing — which is exactly
 * NoSpendPermissions.
 *
 * Test: call WBNB.deposit() with native value, scoped by target only, capped in
 * native. That mirrors the guide's structure using a call that needs no existing
 * token balance.
 */
import "dotenv/config";
import { createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { createPublicClient, http, parseAbi, encodeFunctionData, formatEther, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";

const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex;
const pub = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 30_000 }),
});
const client = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);
const wallet = await client.createWallet({ signer });

const reason = (e: any) => {
  const h = [e?.message, e?.details, e?.cause?.message, e?.cause?.cause?.message].filter(Boolean).join(" | ");
  return h.match(/Reason:\s*(\w+)/)?.[1] ?? String(e?.shortMessage ?? e?.message ?? e).slice(0, 90);
};

const depositData = encodeFunctionData({ abi: parseAbi(["function deposit()"]), functionName: "deposit" });
const VALUE = 10n ** 13n; // 0.00001 BNB

console.log(`\n  CANONICAL SHAPE FROM THE DEX GUIDE`);
console.log(`  wallet ${wallet.address}`);
console.log(`  call   WBNB.deposit() with ${formatEther(VALUE)} BNB of value\n`);

const variants = [
  {
    label: "target only + native cap  (guide shape)",
    permissions: {
      calls: [{ to: WBNB }],
      spend: [{ limit: 10n ** 16n, period: "day" as const }],
    },
  },
  {
    label: "target only, no spend cap at all",
    permissions: {
      calls: [{ to: WBNB }],
    },
  },
];

for (const v of variants) {
  let session;
  try {
    session = await client.grantSession({
      wallet, signer,
      permissions: v.permissions as any,
      expiry: Math.floor(Date.now() / 1000) + 900,
    });
  } catch (e: any) {
    console.log(`  grant FAILED  ${v.label}  ${reason(e)}`);
    continue;
  }

  try {
    const res = await client.execute({
      session,
      calls: [{ to: WBNB, data: depositData, value: VALUE }],
    });
    const tx = (res as any)?.transactionHash;
    console.log(`  ALLOWED  ${v.label}`);
    if (tx) console.log(`           tx ${tx}`);
    console.log(`\n  SOLVED. The call permission takes the target contract; the spend`);
    console.log(`  permission takes the token that leaves the wallet. Adding a signature,`);
    console.log(`  or capping the target's own token, authorises nothing.`);
    await client.revokeSession({ wallet, signer, session }).catch(() => {});
    break;
  } catch (e: any) {
    console.log(`  REFUSED  ${v.label}  ${reason(e)}`);
  }
  await client.revokeSession({ wallet, signer, session }).catch(() => {});
}

console.log("");
