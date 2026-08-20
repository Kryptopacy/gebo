/**
 * Final isolation: what does a session actually need to execute an ERC-20 call?
 *
 * The error progression has been informative:
 *   spend only, no calls          -> UnauthorizedCall     (no scope reaches the account)
 *   calls + native spend only     -> NoSpendPermissions   (the token isn't covered)
 *
 * NoSpendPermissions is specific: the validator wants a spend permission for the
 * token the call touches. A native cap does not cover an ERC-20 interaction. So
 * the working shape should be a call allowlist plus a per-token cap.
 *
 * This tests each combination so the requirement is documented rather than
 * guessed — and so GEBO's preset scopes can be corrected to match what the
 * validator actually enforces.
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

const approveData = encodeFunctionData({
  abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
  functionName: "approve", args: [SPENDER, 1n],
});

function reason(e: any): string {
  const hay = [e?.message, e?.details, e?.cause?.message, e?.cause?.cause?.message].filter(Boolean).join(" | ");
  return (hay.match(/Reason:\s*(\w+)/)?.[1]) ?? String(e?.shortMessage ?? e?.message ?? e).slice(0, 70);
}

const SIG = "approve(address,uint256)";

const cases = [
  {
    label: "calls + token cap",
    permissions: {
      calls: [{ to: WBNB, signature: SIG }],
      spend: [{ limit: 10n ** 18n, period: "day" as const, token: WBNB }],
    },
  },
  {
    label: "calls + token cap + native cap",
    permissions: {
      calls: [{ to: WBNB, signature: SIG }],
      spend: [
        { limit: 10n ** 18n, period: "day" as const, token: WBNB },
        { limit: 10n ** 15n, period: "day" as const },
      ],
    },
  },
  {
    label: "token cap only, no calls",
    permissions: {
      spend: [{ limit: 10n ** 18n, period: "day" as const, token: WBNB }],
    },
  },
  {
    label: "signature-only rule + token cap",
    permissions: {
      calls: [{ signature: SIG }],
      spend: [{ limit: 10n ** 18n, period: "day" as const, token: WBNB }],
    },
  },
];

console.log("\n  WHAT A SESSION NEEDS TO EXECUTE AN ERC-20 CALL");
console.log("  " + "=".repeat(64));
console.log(`  wallet ${wallet.address}`);
console.log(`  call   approve(${SPENDER.slice(0, 10)}…, 1) on WBNB\n`);

let working: string | null = null;

for (const c of cases) {
  let session;
  try {
    session = await client.grantSession({
      wallet, signer,
      permissions: c.permissions as any,
      expiry: Math.floor(Date.now() / 1000) + 900,
    });
  } catch (e: any) {
    console.log(`  grant FAILED  ${c.label.padEnd(32)} ${reason(e)}`);
    continue;
  }

  try {
    const res = await client.execute({ session, calls: [{ to: WBNB, data: approveData }] });
    const tx = (res as any)?.transactionHash;
    console.log(`  ALLOWED       ${c.label.padEnd(32)} ${tx ? String(tx).slice(0, 22) + "…" : "executed"}`);
    if (!working) working = c.label;
  } catch (e: any) {
    console.log(`  REFUSED       ${c.label.padEnd(32)} ${reason(e)}`);
  }

  await client.revokeSession({ wallet, signer, session }).catch(() => {});
}

console.log("");
if (working) {
  console.log(`  WORKING SHAPE: ${working}`);
  console.log(`  A session must carry a spend permission for each token it touches;`);
  console.log(`  a native-only cap does not authorise ERC-20 interaction. GEBO's preset`);
  console.log(`  scopes must therefore include a per-token cap for every token an agent`);
  console.log(`  is expected to handle, or the grant will look valid and fail at execute.`);
} else {
  console.log(`  No combination executed. The requirement is not yet isolated; report the`);
  console.log(`  NoSpendPermissions / UnauthorizedCall progression to Altana rather than`);
  console.log(`  presenting session enforcement as verified.`);
}
console.log("");
