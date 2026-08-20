/**
 * Is NoSpendPermissions about the FEE, not the call scope?
 *
 * Reframing after several failed attempts at the call allowlist. Session
 * transactions go through the Altana relay, and the relay charges a fee. Both
 * `execute` and `grantSession` accept a `feeToken`. If the fee is drawn from the
 * wallet and the session has no permission to spend whatever token pays it, the
 * validator would refuse with exactly this error — and no amount of fixing the
 * call allowlist would help.
 *
 * Three variants, cheapest hypothesis first:
 *   A  generous native cap, fee implicitly native
 *   B  explicit feeToken = native (zero address)
 *   C  no call restrictions at all, generous native cap
 *
 * If any succeeds, the requirement is about funding the fee, and GEBO's preset
 * scopes need a native allowance regardless of which tokens an agent trades.
 */
import "dotenv/config";
import { createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { parseAbi, encodeFunctionData, type Address, type Hex } from "viem";

const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const SPENDER = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const;
const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

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
  return (hay.match(/Reason:\s*(\w+)/)?.[1]) ?? String(e?.shortMessage ?? e?.message ?? e).slice(0, 80);
}

console.log(`\n  IS THE FEE THE PROBLEM, NOT THE CALL SCOPE?`);
console.log(`  wallet ${wallet.address}\n`);

// 0.05 BNB — far more than any plausible relay fee, to rule out the amount.
const GENEROUS = 5n * 10n ** 16n;

const variants = [
  {
    label: "A  generous native cap",
    permissions: {
      calls: [{ to: WBNB, signature: "approve(address,uint256)" }],
      spend: [{ limit: GENEROUS, period: "day" as const }],
    },
    feeToken: undefined as Address | undefined,
  },
  {
    label: "B  explicit feeToken = native",
    permissions: {
      calls: [{ to: WBNB, signature: "approve(address,uint256)" }],
      spend: [{ limit: GENEROUS, period: "day" as const }],
    },
    feeToken: NATIVE,
  },
  {
    label: "C  no call limits, generous native",
    permissions: {
      spend: [{ limit: GENEROUS, period: "day" as const }],
    },
    feeToken: NATIVE,
  },
];

let win: string | null = null;

for (const v of variants) {
  let session;
  try {
    session = await client.grantSession({
      wallet, signer,
      permissions: v.permissions as any,
      expiry: Math.floor(Date.now() / 1000) + 900,
      ...(v.feeToken ? { feeToken: v.feeToken } : {}),
    });
  } catch (e: any) {
    console.log(`  grant FAILED  ${v.label}  ${reason(e)}`);
    continue;
  }

  try {
    const res = await client.execute({
      session,
      calls: [{ to: WBNB, data: approveData }],
      ...(v.feeToken ? { feeToken: v.feeToken } : {}),
    });
    const tx = (res as any)?.transactionHash;
    console.log(`  ALLOWED       ${v.label}`);
    if (tx) console.log(`                tx ${tx}`);
    win = v.label;
    break;
  } catch (e: any) {
    console.log(`  REFUSED       ${v.label}  ${reason(e)}`);
  }
}

console.log("");
if (win) {
  console.log(`  SOLVED by: ${win}`);
  console.log(`  Session execution needs an allowance covering the relay fee. GEBO's`);
  console.log(`  presets must therefore include a native allowance for every scope, or a`);
  console.log(`  grant will look valid and fail only at execute.`);
} else {
  console.log(`  Not the fee either. Stopping here: the read path (isValidKey, revocation)`);
  console.log(`  is proven and sufficient for GEBO's Blast Radius. Session execution is one`);
  console.log(`  assertion, not the Altana track — grant and revoke transactions are already`);
  console.log(`  on chain. Raise the UnauthorizedCall -> NoSpendPermissions progression with`);
  console.log(`  Altana rather than spending more testnet gas on guesses.`);
}
console.log("");
