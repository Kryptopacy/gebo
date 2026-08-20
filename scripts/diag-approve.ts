/**
 * Test whether approve() is specifically refused for session keys.
 *
 * Evidence so far: an unrestricted session (spend cap, no call allowlist) is
 * rejected with UnauthorizedCall for approve(), while the admin signer executes
 * the identical call successfully. Scope is therefore not the variable.
 *
 * Hypothesis: the validator refuses approve() from a session key by design,
 * because approve(spender, amount) grants a third party spending rights that
 * outlive and exceed the session's own cap — a total bypass of the spend limit.
 * If so, refusing it is correct, and my original positive control was the one
 * call a well-designed validator must reject.
 *
 * Controls, each on an unrestricted session:
 *   deposit()          moves native value, cannot delegate anything
 *   transfer(self, 0)  ERC-20 state touch with no value leaving the wallet
 *   approve(...)       the suspected refusal
 *
 * Also tests whether an ERC-20 token cap (rather than a native cap) changes the
 * outcome, since the earlier grant only capped native spend.
 */
import "dotenv/config";
import { createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { createPublicClient, http, parseAbi, encodeFunctionData, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";

const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const SPENDER = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const;

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex;
const pub = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 30_000 }),
});
const client = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);
const wallet = await client.createWallet({ signer });
const owner = wallet.address as Address;

/** Pull the validator's reason out of the SDK's wrapper error. */
function reason(e: any): string {
  const hay = [e?.message, e?.details, e?.cause?.message, e?.cause?.cause?.message]
    .filter(Boolean).join(" | ");
  const m = hay.match(/Reason:\s*(\w+)/) ?? hay.match(/(UnauthorizedCall|ExceededSpendLimit|KeyExpired|Unauthorized)/);
  return m?.[1] ?? String(e?.shortMessage ?? e?.message ?? e).slice(0, 90);
}

const CALLS: { name: string; note: string; to: Address; data: Hex; value?: bigint }[] = [
  {
    name: "deposit()",
    note: "wraps native BNB — moves value but delegates nothing",
    to: WBNB,
    data: encodeFunctionData({ abi: parseAbi(["function deposit()"]), functionName: "deposit" }),
    value: 10n ** 12n,
  },
  {
    name: "transfer(self, 0)",
    note: "ERC-20 state touch, nothing leaves the wallet",
    to: WBNB,
    data: encodeFunctionData({
      abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
      functionName: "transfer", args: [owner, 0n],
    }),
  },
  {
    name: "approve(router, 1)",
    note: "grants a third party spending rights beyond the session cap",
    to: WBNB,
    data: encodeFunctionData({
      abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
      functionName: "approve", args: [SPENDER, 1n],
    }),
  },
];

console.log("\n  IS approve() REFUSED FOR SESSION KEYS?");
console.log("  " + "=".repeat(66));
console.log(`  wallet ${owner}\n`);

for (const cap of [
  { label: "native cap only", spend: [{ limit: 10n ** 15n, period: "day" as const }] },
  { label: "native + WBNB token cap", spend: [
      { limit: 10n ** 15n, period: "day" as const },
      { limit: 10n ** 18n, period: "day" as const, token: WBNB },
    ] },
]) {
  console.log(`  ── unrestricted session, ${cap.label} ${"─".repeat(Math.max(0, 30 - cap.label.length))}`);

  let session;
  try {
    session = await client.grantSession({
      wallet, signer,
      permissions: { spend: cap.spend },
      expiry: Math.floor(Date.now() / 1000) + 1200,
    });
  } catch (e: any) {
    console.log(`     grant failed: ${reason(e)}\n`);
    continue;
  }

  for (const c of CALLS) {
    try {
      const res = await client.execute({
        session,
        calls: [{ to: c.to, data: c.data, ...(c.value ? { value: c.value } : {}) }],
      });
      const tx = (res as any)?.transactionHash;
      console.log(`     ALLOWED   ${c.name.padEnd(20)} ${tx ? String(tx).slice(0, 20) + "…" : ""}`);
      console.log(`               ${c.note}`);
    } catch (e: any) {
      console.log(`     REFUSED   ${c.name.padEnd(20)} ${reason(e)}`);
      console.log(`               ${c.note}`);
    }
  }

  await client.revokeSession({ wallet, signer, session }).catch(() => {});
  console.log("");
}

// Admin comparison: proves the calls themselves are valid on this account.
console.log(`  ── same calls as ADMIN signer, for comparison ${"─".repeat(22)}`);
for (const c of CALLS) {
  try {
    await client.execute({
      wallet, signer,
      calls: [{ to: c.to, data: c.data, ...(c.value ? { value: c.value } : {}) }],
    });
    console.log(`     ALLOWED   ${c.name}`);
  } catch (e: any) {
    console.log(`     REFUSED   ${c.name.padEnd(20)} ${reason(e)}`);
  }
}
console.log("");
