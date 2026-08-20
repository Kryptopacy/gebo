/**
 * Altana session spike - the safety thesis, tested rather than asserted.
 *
 * GEBO's central claim is that an agent's limits are enforced on chain by the
 * session validator, not by the good behaviour of the marketplace or the agent.
 *
 * Six assertions on BNB Smart Chain Testnet (97):
 *
 *   1  grant        a session scoped to one contract, with a spend cap
 *   2  in scope     the permitted call succeeds
 *   3  spend cap    an UNCAPPED token cannot be moved, even from that contract
 *   4  wrong target the same call on a different contract is refused
 *   5  third party  the authority is readable from the Keystore by anyone
 *   6  revoke       after revocation the previously permitted call fails
 *
 * Assertions 3, 4 and 6 pass by FAILING - a revert is the wanted result.
 *
 * The verdict deliberately requires assertion 2 to pass. An earlier run reported
 * 5/6 with the positive control failing and declared enforcement upheld, which
 * was wrong: if every call reverts then universal failure is indistinguishable
 * from enforcement, and the refusals prove nothing.
 *
 * PERMISSION SHAPE. Verified against Altana's DEX guide after several failures:
 *   calls: [{ to: contract }]                    target only, no signature
 *   spend: [{ limit, period, token? }]           the token that LEAVES the wallet
 * Passing {to, signature} pairs looks tighter but authorises nothing, and every
 * execute fails with NoSpendPermissions.
 *
 * This file is ASCII-only. Literal em dashes were previously written as
 * Windows-1252 bytes and broke the bundler.
 */
import "dotenv/config";
import {
  createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey,
} from "@altananetwork/sdk";
import {
  createPublicClient, http, parseAbi, encodeFunctionData, formatEther, keccak256,
  type Address, type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";

// BNB testnet. WBNB is the in-scope target; USDT is the out-of-scope one.
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const OTHER_TOKEN = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
const SPENDER = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const;

const KEYSTORE_ABI = parseAbi([
  "function getKeys(address user) view returns (bytes32[])",
  "function isValidKey(address user, bytes32 keyId) view returns (bool)",
]);

const results: { n: number; name: string; expect: string; pass: boolean; detail: string }[] = [];
function record(n: number, name: string, expect: string, pass: boolean, detail: string) {
  results.push({ n, name, expect, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${n}. ${name}`);
  console.log(`        expected: ${expect}`);
  console.log(`        observed: ${detail}\n`);
}

const short = (e: any) => String(e?.shortMessage ?? e?.message ?? e).slice(0, 150);

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex | undefined;
if (!pk) { console.error("DEMO_OWNER_PRIVATE_KEY missing"); process.exit(1); }

const pub = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 30_000 }),
});

const client = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);

console.log("\n  ALTANA SESSION SPIKE - BNB Smart Chain Testnet (97)");
console.log("  " + "=".repeat(68) + "\n");

const wallet = await client.createWallet({ signer });
const owner = wallet.address as Address;
const bal = await pub.getBalance({ address: owner });
console.log(`  wallet    ${owner}`);
console.log(`  balance   ${formatEther(bal)} tBNB`);
console.log(`  keystore  ${BNB_TESTNET.keyStore}`);
console.log(`  relay     ${BNB_TESTNET.relayUrl}\n`);

if (bal === 0n) { console.error("  wallet has no gas, cannot run the spike\n"); process.exit(1); }

const depositData = encodeFunctionData({
  abi: parseAbi(["function deposit()"]), functionName: "deposit",
});
const transferWbnb = encodeFunctionData({
  abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
  functionName: "transfer", args: [SPENDER, 1n],
});
const approveOther = encodeFunctionData({
  abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
  functionName: "approve", args: [SPENDER, 1n],
});

let session: Awaited<ReturnType<typeof client.grantSession>> | null = null;

// 1. Grant a session scoped to WBNB, capped in native only.
try {
  session = await client.grantSession({
    wallet,
    signer,
    permissions: {
      calls: [{ to: WBNB }],
      spend: [{ limit: 10n ** 16n, period: "day" }],
    },
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });
  record(1, "Grant a scoped session", "session granted, scoped to one contract",
    !!session.publicKey,
    `publicKey ${session.publicKey.slice(0, 22)}... expiry ${new Date(session.expiry * 1000).toISOString()}` +
    (session.transactionHash ? ` tx ${session.transactionHash.slice(0, 18)}...` : " (no receipt surfaced)"));
} catch (e) {
  record(1, "Grant a scoped session", "session granted", false, short(e));
}

if (session) {
  // 2. Positive control. deposit() wraps native BNB: inside the target rule and
  //    inside the native cap. Needs no pre-existing token balance.
  try {
    const res = await client.execute({
      session, calls: [{ to: WBNB, data: depositData, value: 10n ** 13n }],
    });
    const tx = (res as any)?.transactionHash;
    record(2, "In-scope call succeeds", "deposit() on WBNB is permitted", true,
      `executed${tx ? ` tx ${String(tx).slice(0, 18)}...` : ""}`);
  } catch (e) {
    record(2, "In-scope call succeeds", "deposit() on WBNB is permitted", false, `reverted: ${short(e)}`);
  }

  // 3. Spend is a separate dimension: WBNB is callable but uncapped, so moving
  //    WBNB out must still fail.
  try {
    await client.execute({ session, calls: [{ to: WBNB, data: transferWbnb }] });
    record(3, "Spend cap is a separate dimension",
      "moving WBNB must fail, the cap covers native only", false,
      "the transfer SUCCEEDED, so an uncapped token left an allowed contract");
  } catch (e) {
    record(3, "Spend cap is a separate dimension",
      "moving WBNB must fail, the cap covers native only", true, `refused: ${short(e)}`);
  }

  // 4. Target scoping: same call shape, different contract.
  try {
    await client.execute({ session, calls: [{ to: OTHER_TOKEN, data: approveOther }] });
    record(4, "Target scoping is enforced", "a call to another token must be refused", false,
      "the call SUCCEEDED, so contract scoping is not enforced");
  } catch (e) {
    record(4, "Target scoping is enforced", "a call to another token must be refused", true,
      `refused: ${short(e)}`);
  }

  // 5. Anyone can verify the authority: a plain public read.
  try {
    const keyIds = await pub.readContract({
      address: BNB_TESTNET.keyStore as Address, abi: KEYSTORE_ABI,
      functionName: "getKeys", args: [owner],
    }) as readonly Hex[];

    const derived = keccak256(session.publicKey);
    const match = keyIds.find((k) => k.toLowerCase() === derived.toLowerCase());
    let valid = false;
    if (match) {
      valid = await pub.readContract({
        address: BNB_TESTNET.keyStore as Address, abi: KEYSTORE_ABI,
        functionName: "isValidKey", args: [owner, match],
      }) as boolean;
    }
    record(5, "Authority is publicly verifiable",
      "the session key is in the Keystore and reads as valid", !!match && valid,
      match
        ? `keyId ${match.slice(0, 18)}... isValidKey=${valid}, read with no admin key, ${keyIds.length} key(s) on wallet`
        : `not in Keystore. ${keyIds.length} key(s) found. Granted with register:false it would be enforced but invisible.`);
  } catch (e) {
    record(5, "Authority is publicly verifiable", "Keystore read succeeds", false, short(e));
  }

  // 6. Revocation, then repeat the call that previously worked.
  try {
    const rev = await client.revokeSession({ wallet, signer, session });
    const rtx = (rev as any)?.transactionHash;
    console.log(`  revoked${rtx ? ` tx ${String(rtx).slice(0, 18)}...` : ""}\n`);
    try {
      await client.execute({ session, calls: [{ to: WBNB, data: depositData, value: 10n ** 13n }] });
      record(6, "Revocation takes effect", "the previously permitted call must now fail", false,
        "the call SUCCEEDED after revocation");
    } catch (e) {
      record(6, "Revocation takes effect", "the previously permitted call must now fail", true,
        `refused: ${short(e)}`);
    }
  } catch (e) {
    record(6, "Revocation takes effect", "revokeSession succeeds", false, `revoke failed: ${short(e)}`);
  }
}

// Verdict.
const passed = results.filter((r) => r.pass).length;
console.log("  " + "=".repeat(68));
console.log(`  ${passed}/${results.length} assertions passed`);
for (const r of results) console.log(`    ${r.pass ? "ok  " : "FAIL"} ${r.n}. ${r.name}`);

const positive = results.find((r) => r.n === 2);
const negatives = results.filter((r) => [3, 4, 6].includes(r.n));
const enforced = !!positive?.pass && negatives.length > 0 && negatives.every((r) => r.pass);

console.log(`\n  Enforcement claim: ${enforced ? "UPHELD" : positive?.pass ? "NOT UPHELD" : "INCONCLUSIVE"}`);
if (enforced) {
  console.log("  A permitted call succeeds, out-of-scope targets are refused, an uncapped");
  console.log("  token cannot leave an allowed contract, and revocation is effective. The");
  console.log("  blast radius therefore describes an enforced limit, not a promise.");
} else if (!positive?.pass) {
  console.log("  The permitted call did not succeed, so the refusals prove nothing:");
  console.log("  universal failure looks identical to enforcement.");
} else {
  console.log("  An out-of-scope call was permitted. The blast radius cannot be presented");
  console.log("  as an enforced guarantee until that is understood.");
}
console.log("");
