/**
 * Does the call permission expect a 4-byte selector rather than a signature string?
 *
 * Evidence: the account authorises the session key (role=session, correct
 * expiry) but records no permissions against it, and every call — in scope or
 * not — returns UnauthorizedCall. An empty permission set allows nothing, so the
 * scope is not reaching the account.
 *
 * The SDK types `CallPermission.signature` as `string`, and the docs use
 * human-readable forms. If the validator actually matches on a 4-byte selector,
 * a human string would silently match nothing — producing exactly this
 * behaviour, with no error at grant time.
 *
 * Four candidate forms, each granted and then exercised against the call it is
 * supposed to permit. Whichever ALLOWS is the correct encoding.
 */
import "dotenv/config";
import { createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { createPublicClient, http, parseAbi, encodeFunctionData, toFunctionSelector, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";

const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const SPENDER = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const;

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex;
const client = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);
const wallet = await client.createWallet({ signer });

const approveData = encodeFunctionData({
  abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
  functionName: "approve", args: [SPENDER, 1n],
});
const selector = toFunctionSelector("approve(address,uint256)");

function reason(e: any): string {
  const hay = [e?.message, e?.details, e?.cause?.message, e?.cause?.cause?.message].filter(Boolean).join(" | ");
  const m = hay.match(/Reason:\s*(\w+)/);
  return m?.[1] ?? String(e?.shortMessage ?? e?.message ?? e).slice(0, 80);
}

const forms: { label: string; signature: string }[] = [
  { label: "4-byte selector", signature: selector },
  { label: "canonical signature", signature: "approve(address,uint256)" },
  { label: "signature with returns", signature: "approve(address,uint256) returns (bool)" },
  { label: "name only", signature: "approve" },
];

console.log("\n  WHICH CALL-PERMISSION ENCODING DOES THE VALIDATOR MATCH?");
console.log("  " + "=".repeat(64));
console.log(`  wallet   ${wallet.address}`);
console.log(`  selector ${selector}   (approve(address,uint256))\n`);

for (const f of forms) {
  let session;
  try {
    session = await client.grantSession({
      wallet, signer,
      permissions: {
        calls: [{ to: WBNB, signature: f.signature }],
        spend: [{ limit: 10n ** 15n, period: "day" }],
      },
      expiry: Math.floor(Date.now() / 1000) + 900,
    });
  } catch (e: any) {
    console.log(`  grant FAILED  ${f.label.padEnd(24)} ${reason(e)}`);
    continue;
  }

  try {
    const res = await client.execute({ session, calls: [{ to: WBNB, data: approveData }] });
    const tx = (res as any)?.transactionHash;
    console.log(`  ALLOWED       ${f.label.padEnd(24)} "${f.signature}"`);
    if (tx) console.log(`                tx ${tx}`);
    console.log(`                => this is the encoding the validator matches\n`);
  } catch (e: any) {
    console.log(`  REFUSED       ${f.label.padEnd(24)} "${f.signature}"  ${reason(e)}`);
  }

  await client.revokeSession({ wallet, signer, session }).catch(() => {});
}

console.log("");
