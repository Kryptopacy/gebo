/**
 * Altana session spike — the safety thesis, tested rather than asserted.
 *
 * GEBO's central claim is that an agent's limits are enforced on chain by the
 * session validator, not by the good behaviour of the marketplace or the agent.
 * That claim has been unverifiable until now for want of testnet gas. This
 * proves or refutes it.
 *
 * Six assertions, on BNB Smart Chain Testnet (97):
 *
 *   1  grant       a session scoped to ONE contract and ONE function
 *   2  in-scope    the allowed call succeeds
 *   3  wrong fn    a different function on the SAME contract reverts
 *   4  wrong target the same function on a DIFFERENT contract reverts
 *   5  third party the authority is readable from the Keystore by anyone
 *   6  revoke      after revocation the previously-allowed call fails
 *
 * Assertions 3, 4 and 6 pass by FAILING. A revert is the result we want; a
 * success there would mean the enforcement claim is false and the Blast Radius
 * panel is decoration.
 *
 * Positive control is WBNB.approve, chosen because it needs no liquidity, no
 * price and no counterparty — it isolates the validator from market conditions.
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

// BNB testnet. WBNB is the positive-control target; USDT stands in as the
// out-of-allowlist target for assertion 4.
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const OTHER_TOKEN = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
const SPENDER = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const; // PCS testnet router

const KEYSTORE_ABI = parseAbi([
  "function getKeys(address user) view returns (bytes32[])",
  "function getPublicKey(address user, bytes32 keyId) view returns (bytes)",
  "function isValidKey(address user, bytes32 keyId) view returns (bool)",
]);

const results: { n: number; name: string; expect: string; pass: boolean; detail: string }[] = [];
function record(n: number, name: string, expect: string, pass: boolean, detail: string) {
  results.push({ n, name, expect, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${String(n)}. ${name}`);
  console.log(`        expected: ${expect}`);
  console.log(`        observed: ${detail}\n`);
}

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex | undefined;
if (!pk) { console.error("DEMO_OWNER_PRIVATE_KEY missing"); process.exit(1); }

const pub = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 30_000 }),
});

const client = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);

console.log("\n  ALTANA SESSION SPIKE — BNB Smart Chain Testnet (97)");
console.log("  " + "=".repeat(68) + "\n");

const wallet = await client.createWallet({ signer });
const owner = wallet.address as Address;
const bal = await pub.getBalance({ address: owner });
console.log(`  wallet    ${owner}`);
console.log(`  balance   ${formatEther(bal)} tBNB`);
console.log(`  keystore  ${BNB_TESTNET.keyStore}`);
console.log(`  relay     ${BNB_TESTNET.relayUrl}\n`);

if (bal === 0n) { console.error("  wallet has no gas — cannot run the spike\n"); process.exit(1); }

let session: Awaited<ReturnType<typeof client.grantSession>> | null = null;

// ── 1 · grant a deliberately narrow session ───────────────────────────────
try {
  session = await client.grantSession({
    wallet,
    signer,
    permissions: {
      // AND semantics: this exact function, on this exact contract, only.
      calls: [{ to: WBNB, signature: "approve(address,uint256)" }],
      // Native cap. BNB uses 18 decimals; see spendCap() for why this matters.
      spend: [{ limit: 10n ** 15n, period: "day" }],
    },
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });
  record(1, "Grant a scoped session", "session granted with one allowed call",
    !!session.publicKey,
    `publicKey ${session.publicKey.slice(0, 22)}… expiry ${new Date(session.expiry * 1000).toISOString()}` +
    (session.transactionHash ? ` tx ${session.transactionHash.slice(0, 18)}…` : " (no receipt surfaced)"));
} catch (e: any) {
  record(1, "Grant a scoped session", "session granted", false, String(e?.shortMessage ?? e?.message ?? e).slice(0, 220));
}

if (session) {
  // ── 2 · the allowed call must succeed ───────────────────────────────────
  try {
    const res = await client.execute({
      session,
      calls: [{
        to: WBNB,
        data: encodeFunctionData({
          abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
          functionName: "approve",
          args: [SPENDER, 1n],
        }),
      }],
    });
    record(2, "In-scope call succeeds", "approve() on WBNB is permitted", true,
      `executed${(res as any)?.transactionHash ? ` tx ${String((res as any).transactionHash).slice(0, 18)}…` : ""}`);
  } catch (e: any) {
    record(2, "In-scope call succeeds", "approve() on WBNB is permitted", false,
      `reverted: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)}`);
  }

  // ── 3 · different function, same contract → must revert ─────────────────
  try {
    await client.execute({
      session,
      calls: [{
        to: WBNB,
        data: encodeFunctionData({
          abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
          functionName: "transfer",
          args: [SPENDER, 1n],
        }),
      }],
    });
    record(3, "Selector scoping is enforced", "transfer() on WBNB must be rejected", false,
      "the call SUCCEEDED — function-level scoping is not enforced");
  } catch (e: any) {
    record(3, "Selector scoping is enforced", "transfer() on WBNB must be rejected", true,
      `rejected: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 160)}`);
  }

  // ── 4 · same function, different contract → must revert ─────────────────
  try {
    await client.execute({
      session,
      calls: [{
        to: OTHER_TOKEN,
        data: encodeFunctionData({
          abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
          functionName: "approve",
          args: [SPENDER, 1n],
        }),
      }],
    });
    record(4, "Target scoping is enforced", "approve() on another token must be rejected", false,
      "the call SUCCEEDED — contract-level scoping is not enforced");
  } catch (e: any) {
    record(4, "Target scoping is enforced", "approve() on another token must be rejected", true,
      `rejected: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 160)}`);
  }

  // ── 5 · a third party can read the authority ────────────────────────────
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
    record(5, "Authority is publicly verifiable", "the session key appears in the Keystore and reads as valid",
      !!match && valid,
      match
        ? `keyId ${match.slice(0, 18)}… isValidKey=${valid} (read with no admin key, ${keyIds.length} key(s) on wallet)`
        : `session key NOT in Keystore — ${keyIds.length} key(s) found. Granted with register:false it would be enforced but invisible.`);
  } catch (e: any) {
    record(5, "Authority is publicly verifiable", "Keystore read succeeds", false,
      String(e?.shortMessage ?? e?.message ?? e).slice(0, 200));
  }

  // ── 6 · after revocation the allowed call must fail ─────────────────────
  try {
    const rev = await client.revokeSession({ wallet, signer, session });
    console.log(`  revoked${(rev as any)?.transactionHash ? ` tx ${String((rev as any).transactionHash).slice(0, 18)}…` : ""}\n`);

    try {
      await client.execute({
        session,
        calls: [{
          to: WBNB,
          data: encodeFunctionData({
            abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
            functionName: "approve",
            args: [SPENDER, 1n],
          }),
        }],
      });
      record(6, "Revocation takes effect", "the previously-allowed call must now fail", false,
        "the call SUCCEEDED after revocation — revocation is not effective");
    } catch (e: any) {
      record(6, "Revocation takes effect", "the previously-allowed call must now fail", true,
        `rejected: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 160)}`);
    }
  } catch (e: any) {
    record(6, "Revocation takes effect", "revokeSession succeeds", false,
      `revoke failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)}`);
  }
}

// ── verdict ────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.pass).length;
console.log("  " + "=".repeat(68));
console.log(`  ${passed}/${results.length} assertions passed`);
for (const r of results) console.log(`    ${r.pass ? "ok  " : "FAIL"} ${r.n}. ${r.name}`);

const enforcement = results.filter((r) => [3, 4, 6].includes(r.n));
const enforced = enforcement.length > 0 && enforcement.every((r) => r.pass);
console.log(`\n  Enforcement claim: ${enforced ? "UPHELD" : "NOT UPHELD"}`);
console.log(enforced
  ? "  Out-of-scope calls revert and revocation is effective, so GEBO's blast\n  radius describes an enforced limit rather than a promise."
  : "  At least one out-of-scope call was permitted. The blast radius cannot be\n  presented as an enforced guarantee until this is understood.");
console.log("");
