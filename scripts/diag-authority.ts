/**
 * Compare the Keystore's view of authority with the account's own.
 *
 * The Keystore reports the session key as valid, yet the account rejects every
 * call from it with UnauthorizedCall. Those two facts cannot both describe a
 * working grant, so one of the two registries disagrees.
 *
 * registerSessionKey's own documentation states the account authorization comes
 * from the grant itself and that registration only affects third-party
 * visibility — so an authorised-in-Keystore, unauthorised-at-account state is
 * not a documented outcome. This isolates which side is wrong before reporting
 * it upstream.
 */
import "dotenv/config";
import { createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { getKeys } from "porto/viem/RelayActions";
import {
  createClient as createViemClient, createPublicClient, http, parseAbi, keccak256,
  type Address, type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";

const KEYSTORE_ABI = parseAbi([
  "function getKeys(address user) view returns (bytes32[])",
  "function getPublicKey(address user, bytes32 keyId) view returns (bytes)",
  "function isValidKey(address user, bytes32 keyId) view returns (bool)",
]);

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex;
const pub = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 30_000 }),
});

const altana = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(pk);
const wallet = await altana.createWallet({ signer });
const owner = wallet.address as Address;

console.log("\n  KEYSTORE vs ACCOUNT AUTHORITY");
console.log("  " + "=".repeat(64));
console.log(`  wallet ${owner}\n`);

// ── grant a fresh session and capture its provenance ──────────────────────
const session = await altana.grantSession({
  wallet, signer,
  permissions: { spend: [{ limit: 10n ** 15n, period: "day" }] },
  expiry: Math.floor(Date.now() / 1000) + 1800,
});

console.log(`  granted`);
console.log(`    publicKey        ${session.publicKey}`);
console.log(`    keccak(publicKey) ${keccak256(session.publicKey)}`);
console.log(`    expiry           ${new Date(session.expiry * 1000).toISOString()}`);
console.log(`    grant tx         ${session.transactionHash ?? "(none surfaced)"}`);

// Did the grant transaction actually land?
if (session.transactionHash) {
  try {
    const r = await pub.getTransactionReceipt({ hash: session.transactionHash });
    console.log(`    grant receipt    status=${r.status} gasUsed=${r.gasUsed} logs=${r.logs.length}`);
    if (r.status !== "success") {
      console.log(`    => the grant transaction REVERTED; the account never authorised the key`);
    }
  } catch (e: any) {
    console.log(`    grant receipt    not retrievable: ${String(e?.shortMessage ?? e?.message).slice(0, 80)}`);
  }
}

// ── the Keystore's view ───────────────────────────────────────────────────
const keyIds = await pub.readContract({
  address: BNB_TESTNET.keyStore as Address, abi: KEYSTORE_ABI,
  functionName: "getKeys", args: [owner],
}) as readonly Hex[];

console.log(`\n  KEYSTORE (${BNB_TESTNET.keyStore})`);
console.log(`    keys registered  ${keyIds.length}`);
for (const k of keyIds.slice(-4)) {
  const valid = await pub.readContract({
    address: BNB_TESTNET.keyStore as Address, abi: KEYSTORE_ABI,
    functionName: "isValidKey", args: [owner, k],
  }) as boolean;
  const isOurs = k.toLowerCase() === keccak256(session.publicKey).toLowerCase();
  console.log(`    ${k.slice(0, 20)}…  valid=${valid}${isOurs ? "   <-- this session" : ""}`);
}

// ── the account's own view, via the relay ─────────────────────────────────
console.log(`\n  ACCOUNT (via relay wallet_getKeys)`);
try {
  const relay = createViemClient({
    chain: bscTestnet,
    transport: http(BNB_TESTNET.relayUrl, { timeout: 30_000 }),
  });
  const keys = await getKeys(relay as any, { account: owner } as any);
  console.log(`    keys authorised  ${keys.length}`);
  for (const k of keys as any[]) {
    const kh = k.hash ?? k.keyHash ?? "?";
    console.log(`    ${String(kh).slice(0, 20)}…  type=${k.type ?? "?"} role=${k.role ?? "?"} expiry=${k.expiry ?? "?"}`);
    if (k.permissions) console.log(`        permissions: ${JSON.stringify(k.permissions).slice(0, 180)}`);
  }
  if (!keys.length) {
    console.log(`    => the account has authorised NO keys. The grant registered in the`);
    console.log(`       Keystore but never authorised at the account, which is why every`);
    console.log(`       session call returns UnauthorizedCall.`);
  }
} catch (e: any) {
  console.log(`    relay getKeys failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)}`);
}

await altana.revokeSession({ wallet, signer, session }).catch(() => {});
console.log("");
