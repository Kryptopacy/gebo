/**
 * Blast Radius reader — reads real agent authority from the Altana Keystore on
 * BNB Smart Chain mainnet.
 *
 * This is the differentiator that needs no funds: Altana documents these reads
 * as permissionless ("needs no admin key, no session, and nothing from Altana"),
 * so authority can be verified against production data rather than a testnet toy.
 *
 * Known limitation being tested here: the Keystore exposes getKeys, isValidKey
 * and getPublicKey, but NO getter for `metadata`, `validator` or `expiry` — the
 * three fields that actually carry the permission set. Those are arguments to
 * registerKey. So a third party must recover them from event logs or calldata.
 * This script establishes which of those paths works.
 *
 *   Keystore           0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a
 *   KeyStoreController 0x0834Ee2C9BdC3E3efF0a2dC34393D4B0e546A555
 */
import "dotenv/config";
import {
  createPublicClient, http, fallback, parseAbi, keccak256,
  type Address, type Hex, type PublicClient,
} from "viem";
import { bsc } from "viem/chains";

const KEYSTORE = "0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a" as const;
const CONTROLLER = "0x0834Ee2C9BdC3E3efF0a2dC34393D4B0e546A555" as const;

const keystoreAbi = parseAbi([
  "function getKeys(address user) view returns (bytes32[])",
  "function getPublicKey(address user, bytes32 keyId) view returns (bytes)",
  "function isValidKey(address user, bytes32 keyId) view returns (bool)",
]);

const controllerAbi = parseAbi([
  "function getRegistrationFeeInWei() view returns (uint256)",
]);

/**
 * Candidate getters that would expose the permission set if the deployed
 * contract has a richer ABI than the SDK's subset. Probed, not assumed.
 */
const CANDIDATES = [
  "function getKeyData(address user, bytes32 keyId) view returns (address,bytes,bytes,uint40)",
  "function keys(address user, bytes32 keyId) view returns (address,bytes,bytes,uint40)",
  "function getKey(address user, bytes32 keyId) view returns (address,bytes,bytes,uint40)",
  "function getExpiry(address user, bytes32 keyId) view returns (uint40)",
  "function getMetadata(address user, bytes32 keyId) view returns (bytes)",
  "function getValidator(address user, bytes32 keyId) view returns (address)",
  "function keyExpiry(address user, bytes32 keyId) view returns (uint40)",
];

const client = createPublicClient({
  chain: bsc,
  transport: fallback([
    "https://bsc-rpc.publicnode.com",
    "https://binance.llamarpc.com",
    "https://bsc-dataseed1.bnbchain.org",
    "https://bsc-dataseed2.bnbchain.org",
  ].map((u) => http(u, { timeout: 25_000, retryCount: 2 }))),
  batch: { multicall: { wait: 24, batchSize: 512 } },
}) as PublicClient;

const head = await client.getBlockNumber();
console.log(`\n  BSC head block  ${head.toLocaleString()}`);
console.log(`  keystore        ${KEYSTORE}`);

// ── 1. is the contract live and responding? ───────────────────────────────
try {
  const fee = await client.readContract({
    address: CONTROLLER, abi: controllerAbi, functionName: "getRegistrationFeeInWei",
  });
  console.log(`  registration fee ${fee} wei`);
} catch (e: any) {
  console.log(`  registration fee  unreadable: ${String(e?.shortMessage ?? e).slice(0, 80)}`);
}

// ── 2. find real wallets by scanning Keystore logs ────────────────────────
console.log(`\n  scanning Keystore logs for registration activity…`);

/**
 * Public BSC RPCs cap eth_getLogs to roughly 1,000 blocks and reject wider
 * ranges with "Request exceeds defined limit". Start conservative and adapt
 * downward on rejection rather than assuming a fixed span.
 */
let span = 900n;
const MAX_CALLS = 60;
const topics = new Map<string, number>();
const walletCandidates = new Set<Address>();
let logsSeen = 0;
let scanned = 0n;
let cursor = head;

for (let call = 0; call < MAX_CALLS && walletCandidates.size < 40; call++) {
  const to = cursor;
  const from = to - span + 1n;
  try {
    const logs = await client.getLogs({ address: KEYSTORE, fromBlock: from, toBlock: to });
    scanned += span;
    logsSeen += logs.length;
    for (const l of logs) {
      const t0 = l.topics[0] ?? "0x";
      topics.set(t0, (topics.get(t0) ?? 0) + 1);
      // Indexed address params sit in topics 1..3, left-padded to 32 bytes.
      for (const t of l.topics.slice(1)) {
        if (t && /^0x0{24}[0-9a-fA-F]{40}$/.test(t)) {
          walletCandidates.add((`0x${t.slice(26)}`).toLowerCase() as Address);
        }
      }
      // Non-indexed sender still shows on the log's own tx; keep the emitter too.
    }
    cursor = from - 1n;
  } catch (e: any) {
    const msg = String(e?.shortMessage ?? e?.message ?? e);
    if (/exceeds|limit|too large|range/i.test(msg) && span > 50n) {
      span = span / 2n;
      console.log(`    narrowing span to ${span} blocks`);
      continue;
    }
    // Unrelated failure (timeout, node hiccup): skip this window and move on.
    cursor = from - 1n;
  }
}

console.log(`  blocks scanned  ${scanned.toLocaleString()}  logs ${logsSeen}  candidate wallets ${walletCandidates.size}`);
if (topics.size) {
  console.log(`  distinct event topics:`);
  for (const [t, n] of [...topics].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t}  x${n}`);
  }
}

// ── 3. read authority for each candidate ──────────────────────────────────
const wallets = [...walletCandidates].slice(0, 25);
if (!wallets.length) {
  console.log(`\n  No wallets found in the scanned window. Widen MAX_SPANS or the`);
  console.log(`  Keystore may emit no indexed-address events.\n`);
} else {
  console.log(`\n  reading authority for ${wallets.length} wallet(s)…\n`);

  const keySets = await client.multicall({
    contracts: wallets.map((w) => ({
      address: KEYSTORE, abi: keystoreAbi, functionName: "getKeys" as const, args: [w],
    })),
    allowFailure: true,
  });

  let withKeys = 0;
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i]!;
    const res = keySets[i];
    if (res?.status !== "success") continue;
    const keyIds = res.result as readonly Hex[];
    if (!keyIds.length) continue;
    withKeys++;

    console.log(`  ${w}`);
    console.log(`    registered keys: ${keyIds.length}`);

    const valid = await client.multicall({
      contracts: keyIds.map((k) => ({
        address: KEYSTORE, abi: keystoreAbi, functionName: "isValidKey" as const, args: [w, k],
      })),
      allowFailure: true,
    });
    const pubs = await client.multicall({
      contracts: keyIds.map((k) => ({
        address: KEYSTORE, abi: keystoreAbi, functionName: "getPublicKey" as const, args: [w, k],
      })),
      allowFailure: true,
    });

    for (let k = 0; k < keyIds.length; k++) {
      const id = keyIds[k]!;
      const isValid = valid[k]?.status === "success" ? valid[k]!.result : "?";
      const pk = pubs[k]?.status === "success" ? String(pubs[k]!.result) : null;
      const derived = pk ? keccak256(pk as Hex) : null;
      const matches = derived ? (derived.toLowerCase() === id.toLowerCase() ? "keyId=keccak(pk) ok" : "keyId MISMATCH") : "no pubkey";
      console.log(`      ${id.slice(0, 18)}…  valid=${isValid}  pk=${pk ? `${pk.length - 2} hex chars` : "none"}  ${matches}`);
    }
    console.log("");
  }

  console.log(`  wallets holding at least one registered key: ${withKeys}/${wallets.length}`);
}

// ── 4. does the deployed contract expose the permission set? ──────────────
console.log(`\n  probing for permission getters beyond the SDK's ABI subset…`);
const probeWallet = wallets[0];
if (probeWallet) {
  const keys = await client.readContract({
    address: KEYSTORE, abi: keystoreAbi, functionName: "getKeys", args: [probeWallet],
  }).catch(() => [] as readonly Hex[]);
  const probeKey = keys[0];

  for (const sig of CANDIDATES) {
    const abi = parseAbi([sig]);
    const fn = sig.match(/function (\w+)/)![1]!;
    const wantsKey = sig.includes("bytes32");
    if (wantsKey && !probeKey) continue;
    try {
      const r = await client.readContract({
        address: KEYSTORE, abi: abi as any, functionName: fn as any,
        args: wantsKey ? [probeWallet, probeKey] : [probeWallet],
      } as any);
      console.log(`    ${fn.padEnd(14)} EXISTS -> ${JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 140)}`);
    } catch {
      console.log(`    ${fn.padEnd(14)} absent`);
    }
  }
} else {
  console.log(`    skipped — no wallet with keys to probe against`);
}
console.log("");
