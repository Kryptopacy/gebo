/**
 * One case, isolated: call allowlist plus a per-token spend cap.
 *
 * Kept to a single grant / execute / revoke because the four-case version issued
 * twelve on-chain transactions and exceeded its window. This is the shape the
 * NoSpendPermissions error points at.
 */
import "dotenv/config";
import { createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { parseAbi, encodeFunctionData, type Hex } from "viem";

const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const SPENDER = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const;

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex;
const client = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);
const wallet = await client.createWallet({ signer });

function reason(e: any): string {
  const hay = [e?.message, e?.details, e?.cause?.message, e?.cause?.cause?.message].filter(Boolean).join(" | ");
  return (hay.match(/Reason:\s*(\w+)/)?.[1]) ?? String(e?.shortMessage ?? e?.message ?? e).slice(0, 90);
}

console.log(`\n  wallet ${wallet.address}`);
console.log(`  grant: calls=[approve on WBNB] + spend=[1 WBNB/day]\n`);

const session = await client.grantSession({
  wallet, signer,
  permissions: {
    calls: [{ to: WBNB, signature: "approve(address,uint256)" }],
    spend: [{ limit: 10n ** 18n, period: "day", token: WBNB }],
  },
  expiry: Math.floor(Date.now() / 1000) + 900,
});
console.log(`  granted ${session.publicKey.slice(0, 24)}…\n`);

try {
  const res = await client.execute({
    session,
    calls: [{
      to: WBNB,
      data: encodeFunctionData({
        abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
        functionName: "approve", args: [SPENDER, 1n],
      }),
    }],
  });
  const tx = (res as any)?.transactionHash;
  console.log(`  ALLOWED — session executed the in-scope call`);
  if (tx) console.log(`  tx ${tx}`);
  console.log(`\n  CONCLUSION: a session needs a spend permission for every token it`);
  console.log(`  touches. A native-only cap does not authorise ERC-20 interaction, and`);
  console.log(`  the grant succeeds regardless — so the failure only appears at execute.`);
} catch (e: any) {
  console.log(`  REFUSED — ${reason(e)}`);
  console.log(`\n  The per-token cap is not sufficient either. Report the progression`);
  console.log(`  (UnauthorizedCall -> NoSpendPermissions) to Altana rather than claiming`);
  console.log(`  session enforcement is verified.`);
}

console.log("");
