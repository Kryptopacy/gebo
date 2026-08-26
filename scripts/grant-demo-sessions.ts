/**
 * Grant live demo sessions - the Altana bounty evidence, produced not described.
 *
 * One scoped session per judged category, granted on BNB Smart Chain MAINNET
 * from the DEMO owner wallet and persisted into public.sessions. Each session
 * carries a real contract allowlist, real spend caps and a bounded expiry
 * (capped at 48h regardless of preset), so the exposure of an unattended demo
 * key is limited by construction rather than by memory.
 *
 * Nothing here is revoked at the end. A revoked session proves nothing to the
 * explorer; an expiring one does, and isValidKey flips false on its own.
 *
 * Permission shape is the verified one from src/lib/session-scope.ts: target-
 * only call rules plus independent spend caps. Re-deriving the shape here would
 * risk drifting from the property-tested generator, so this script only feeds
 * presets through buildPermissions() and stores canonicalise() output byte-exact.
 *
 * ASCII-only source (Windows-1252 write hazard).
 */
import "dotenv/config";
import postgres from "postgres";
import {
  createClient as createAltanaClient, BNB, BNB_TESTNET, signerFromPrivateKey,
} from "@altananetwork/sdk";
import {
  createPublicClient, http, formatEther, type Address, type Hex,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import {
  PRESETS, buildPermissions, canonicalise,
  type ScopePreset, type SpendPermission,
} from "../src/lib/session-scope.ts";
import { readAuthority } from "../src/lib/keystore.ts";

const MAX_EXPIRY_HOURS = 48;

/**
 * Testnet by default, matching spike-altana.ts. Testnet counts for the bounty
 * and mainnet counts for more; the switch exists so a funded mainnet key can be
 * used the day it is funded without editing anything.
 */
const NETWORKS = {
  97: {
    label: "BNB Smart Chain Testnet (97)",
    altana: BNB_TESTNET,
    viemChain: bscTestnet,
    rpc: process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
    explorer: "https://testnet.bscscan.org",
    gasLabel: "tBNB",
  },
  56: {
    label: "BNB Smart Chain mainnet (56)",
    altana: BNB,
    viemChain: bsc,
    rpc: process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com",
    explorer: "https://bscscan.com",
    gasLabel: "BNB",
  },
} as const;

const wantMainnet =
  process.argv.includes("--mainnet") || process.env.GEBO_SPIKE_CHAIN === "56";
const NET = wantMainnet ? NETWORKS[56] : NETWORKS[97];
const CHAIN_ID = wantMainnet ? 56 : 97;

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as Hex | undefined;
if (!pk) { console.error("DEMO_OWNER_PRIVATE_KEY missing"); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

const pub = createPublicClient({
  chain: NET.viemChain,
  transport: http(NET.rpc, { timeout: 30_000 }),
});

const client = createAltanaClient({ chains: [NET.altana] });
const signer = signerFromPrivateKey(pk);

/**
 * health/conservative is watch-only (no contracts, no caps). Whether Altana
 * accepts a completely empty permission object is unverified, and a failed
 * grant here would read as enforcement when it is really a malformed request -
 * the same trap the spike documents. Use the smallest scope that actually
 * carries limits for every category.
 */
const PLAN: { category: string; presetId: string }[] = [
  { category: "rebalancing", presetId: "conservative" },
  { category: "grid",        presetId: "conservative" },
  { category: "yield",       presetId: "conservative" },
  { category: "health",      presetId: "standard" },
];

console.log(`\n  ALTANA DEMO GRANTS - ${NET.label}`);
console.log("  " + "=".repeat(64));

const wallet = await client.createWallet({ signer });
const owner = wallet.address as Address;
const bal = await pub.getBalance({ address: owner });
console.log(`\n  wallet    ${owner}`);
console.log(`  balance   ${formatEther(bal)} ${NET.gasLabel}`);
if (bal === 0n) {
  console.error("\n  wallet has no gas. Fund it or run against the other chain deliberately.\n");
  await sql.end();
  process.exit(1);
}

let granted = 0, skipped = 0, failed = 0;

for (const { category, presetId } of PLAN) {
  const base: ScopePreset | undefined = PRESETS[category]?.find((p) => p.id === presetId);
  if (!base) { console.error(`  ${category}: no such preset ${presetId}, skipping`); failed++; continue; }
  const preset: ScopePreset = { ...base, expiryHours: Math.min(base.expiryHours, MAX_EXPIRY_HOURS) };
  const perms = buildPermissions(preset);
  const canonical = canonicalise(perms);

  const existing = await sql<{ id: number }[]>`
    select id from sessions
    where chain_id = ${CHAIN_ID} and canonical_json = ${canonical}
      and state = 'active' and expiry > now()`;
  if (existing[0]) {
    console.log(`  ${category.padEnd(12)} identical active session #${existing[0].id} not yet expired, skipped`);
    skipped++;
    continue;
  }

  const expirySec = Math.floor(Date.now() / 1000) + preset.expiryHours * 3600;
  try {
    // Our generator emits target-only rules ({ to }), which is the verified
    // working shape; the SDK types the pair form more narrowly than it behaves,
    // so the array is shaped here and cast once at this boundary.
    const sdkCalls = perms.calls.map(
      (c) => ({ to: c.to }) as { to: NonNullable<typeof c.to> },
    );
    const session = await client.grantSession({
      wallet,
      signer,
      permissions: {
        calls: sdkCalls as Parameters<typeof client.grantSession>[0]["permissions"]["calls"],
        spend: perms.spend.map((s: SpendPermission) => ({
          limit: s.limit, period: s.period, ...(s.token ? { token: s.token } : {}),
        })),
      },
      expiry: expirySec,
    });

    const txHash = (session as { transactionHash?: string }).transactionHash ?? null;

    // Independent proof through the same code path the product reads with.
    const proof = await readAuthority(owner, CHAIN_ID);
    const seen = proof.keys.find(
      (k) => k.publicKey && k.publicKey.toLowerCase() === session.publicKey.toLowerCase(),
    );

    const spendJson = perms.spend.map((s) => ({
      limit: s.limit.toString(), period: s.period,
      ...(s.token ? { token: s.token.toLowerCase() } : {}),
      symbol: s.symbol, decimals: s.decimals, humanAmount: s.humanAmount,
    }));

    const row = await sql<{ id: number }[]>`
      insert into sessions
        (chain_id, wallet_address, session_public_key, canonical_json, state, expiry,
         unbounded, call_allowlist, spend_caps, grant_tx_hash, observed_at)
      values
        (${CHAIN_ID}, ${owner}, ${session.publicKey}, ${canonical}, 'active',
         ${new Date(session.expiry * 1000).toISOString()},
         ${perms.calls.length === 0},
         ${JSON.stringify(perms.calls)}::jsonb,
         ${JSON.stringify(spendJson)}::jsonb,
         ${txHash}, now())
      on conflict (chain_id, session_public_key) do update set
        state = 'active',
        expiry = excluded.expiry,
        canonical_json = excluded.canonical_json,
        unbounded = excluded.unbounded,
        call_allowlist = excluded.call_allowlist,
        spend_caps = excluded.spend_caps,
        grant_tx_hash = coalesce(excluded.grant_tx_hash, sessions.grant_tx_hash),
        observed_at = now()
      returning id`;

    granted++;
    console.log(`  ${category.padEnd(12)} granted  session #${row[0]?.id}  row=${String(row[0]?.id)}`);
    console.log(`               scope    ${preset.contracts.join(", ") || "(none)"}`);
    console.log(`               caps     ${preset.caps.map((c) => `${c.amount} ${c.symbol}/${c.period}`).join(", ") || "(none)"}`);
    console.log(`               expires  ${new Date(session.expiry * 1000).toISOString()} (${preset.expiryHours}h)`);
    if (txHash) console.log(`               tx       ${NET.explorer}/tx/${txHash}`);
    console.log(`               keystore ${seen ? `visible, isValidKey=${seen.valid}` : "NOT YET INDEXED (grant tx may still be propagating)"}`);
  } catch (e) {
    failed++;
    const err = e as { shortMessage?: string; message?: string };
    const msg = String(err?.shortMessage ?? err?.message ?? e).slice(0, 160);
    console.log(`  ${category.padEnd(12)} FAILED   ${msg}`);
  }
}

// Final state, measured rather than assumed.
const rows = await sql<{ id: number; state: string; expiry: Date | null }[]>`
  select id, state, expiry from sessions where chain_id = ${CHAIN_ID} order by id`;
console.log("\n  sessions table now holds:");
for (const r of rows)
  console.log(`    #${r.id}  ${r.state}  expires ${r.expiry ? new Date(r.expiry).toISOString() : "-"}`);

console.log(`\n  done: granted=${granted} skipped=${skipped} failed=${failed}`);
console.log(`  view: /authority?wallet=${owner}&chain=${CHAIN_ID}\n`);

await sql.end();
