/**
 * Diagnose why the in-scope call failed in the session spike.
 *
 * This matters more than it looks. With the positive control failing, the two
 * negative controls prove nothing: "everything reverts" is indistinguishable
 * from "scoping is enforced". The enforcement claim cannot be called upheld
 * until an allowed call demonstrably succeeds.
 *
 * The SDK surfaces "An error occurred while executing calls", which is a wrapper.
 * This prints the full error chain, plus the same call executed by the ADMIN
 * signer rather than the session key — if admin succeeds and session fails, the
 * fault is in the session scope; if both fail, it is the account or the relay.
 */
import "dotenv/config";
import {
  createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey,
} from "@altananetwork/sdk";
import {
  createPublicClient, http, parseAbi, encodeFunctionData, formatEther,
  type Address, type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";

const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const SPENDER = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const;

function dumpError(label: string, e: any) {
  console.log(`\n  ${label}`);
  console.log(`    name        ${e?.name ?? "-"}`);
  console.log(`    message     ${String(e?.message ?? e).slice(0, 400)}`);
  if (e?.shortMessage) console.log(`    short       ${e.shortMessage}`);
  if (e?.details) console.log(`    details     ${String(e.details).slice(0, 300)}`);
  if (e?.metaMessages?.length) for (const m of e.metaMessages) console.log(`    meta        ${String(m).slice(0, 200)}`);
  if (e?.data) console.log(`    data        ${JSON.stringify(e.data).slice(0, 300)}`);
  if (e?.cause) {
    console.log(`    cause.name  ${e.cause?.name ?? "-"}`);
    console.log(`    cause.msg   ${String(e.cause?.message ?? e.cause).slice(0, 400)}`);
    if (e.cause?.data) console.log(`    cause.data  ${JSON.stringify(e.cause.data).slice(0, 300)}`);
    if (e.cause?.cause) console.log(`    cause^2     ${String(e.cause.cause?.message ?? e.cause.cause).slice(0, 300)}`);
  }
}

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex;
const pub = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 30_000 }),
});

const client = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);
const wallet = await client.createWallet({ signer });
const owner = wallet.address as Address;

console.log("\n  SESSION EXECUTE DIAGNOSIS");
console.log("  " + "=".repeat(62));
console.log(`  wallet   ${owner}`);
console.log(`  balance  ${formatEther(await pub.getBalance({ address: owner }))} tBNB`);

// Is the smart account actually deployed? An EIP-7702 account has delegated
// code; an undeployed one has none, and the first execute must upgrade it.
const code = await pub.getBytecode({ address: owner });
console.log(`  account  ${code && code !== "0x" ? `deployed, ${(code.length - 2) / 2} bytes` : "NO CODE — not yet upgraded"}`);
if (code && code.startsWith("0xef0100")) {
  console.log(`  7702     delegates to 0x${code.slice(8, 48)}`);
}

const approveData = encodeFunctionData({
  abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
  functionName: "approve",
  args: [SPENDER, 1n],
});

// ── A · admin signer, no session ──────────────────────────────────────────
// Establishes whether the account and relay work at all.
console.log(`\n  A. execute as ADMIN signer (no session involved)`);
try {
  const res = await client.execute({
    wallet, signer, calls: [{ to: WBNB, data: approveData }],
  });
  console.log(`     SUCCESS${(res as any)?.transactionHash ? ` tx ${(res as any).transactionHash}` : ""}`);
  console.log(`     => account and relay are functional; a session failure is a scope problem`);
} catch (e: any) {
  console.log(`     FAILED`);
  dumpError("admin execute error", e);
  console.log(`     => the account or relay is the problem, not session scoping`);
}

// ── B · session with NO call restrictions ─────────────────────────────────
// If an unrestricted session succeeds where a scoped one fails, the signature
// string in the allowlist is not matching the selector.
console.log(`\n  B. session with spend cap but NO call allowlist (unrestricted)`);
try {
  const open = await client.grantSession({
    wallet, signer,
    permissions: { spend: [{ limit: 10n ** 15n, period: "day" }] },
    expiry: Math.floor(Date.now() / 1000) + 1800,
  });
  console.log(`     granted ${open.publicKey.slice(0, 20)}…`);
  try {
    const res = await client.execute({ session: open, calls: [{ to: WBNB, data: approveData }] });
    console.log(`     SUCCESS${(res as any)?.transactionHash ? ` tx ${(res as any).transactionHash}` : ""}`);
    console.log(`     => sessions work. The scoped grant's signature string is not matching.`);
  } catch (e: any) {
    console.log(`     FAILED`);
    dumpError("unrestricted session execute error", e);
    console.log(`     => sessions fail even unrestricted; not a signature-matching issue.`);
  }
  await client.revokeSession({ wallet, signer, session: open }).catch(() => {});
} catch (e: any) {
  console.log(`     grant FAILED`);
  dumpError("grant error", e);
}

// ── C · scoped session, canonical selector form ───────────────────────────
// Altana matches on a signature string. Try the exact form and a variant to see
// whether whitespace or the return type affects the match.
for (const sig of ["approve(address,uint256)", "approve(address,uint256) returns (bool)"]) {
  console.log(`\n  C. scoped session, signature: "${sig}"`);
  try {
    const s = await client.grantSession({
      wallet, signer,
      permissions: {
        calls: [{ to: WBNB, signature: sig }],
        spend: [{ limit: 10n ** 15n, period: "day" }],
      },
      expiry: Math.floor(Date.now() / 1000) + 1800,
    });
    try {
      const res = await client.execute({ session: s, calls: [{ to: WBNB, data: approveData }] });
      console.log(`     SUCCESS${(res as any)?.transactionHash ? ` tx ${(res as any).transactionHash}` : ""}`);
    } catch (e: any) {
      console.log(`     FAILED: ${String(e?.shortMessage ?? e?.message).slice(0, 140)}`);
    }
    await client.revokeSession({ wallet, signer, session: s }).catch(() => {});
  } catch (e: any) {
    console.log(`     grant FAILED: ${String(e?.shortMessage ?? e?.message).slice(0, 140)}`);
  }
}

console.log("");
