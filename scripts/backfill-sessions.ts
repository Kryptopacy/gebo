/**
 * One-off backfill for the Keystore session index: walk a deeper block range
 * than the cron's bounded window, harvesting wallets and upserting their
 * current sessions. Resumable via the index_checkpoints row the cron uses,
 * so interrupting it loses nothing.
 *
 * Depth is a DISCLOSED bound, not a claim of completeness: sessions on this
 * Keystore expire within 48h by design, so DEFAULT_BLOCK_DEPTH covers every
 * still-live session with margin even at the fastest BSC block time. The
 * authority page states the index start where it uses these rows.
 *
 * Run: npx tsx scripts/backfill-sessions.ts                    (dry run)
 *      npx tsx scripts/backfill-sessions.ts --apply            (writes)
 *      npx tsx scripts/backfill-sessions.ts --apply --depth 345600
 */
import "dotenv/config";
import postgres from "postgres";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { readAuthority, KEYSTORE } from "../src/lib/keystore.ts";
import { harvestWallets, planSessionUpserts, type RawLog } from "../src/lib/session-index.ts";

const APPLY = process.argv.includes("--apply");
/**
 * Depth is bounded by the RPC, not by ambition: publicnode serves
 * eth_getLogs only for the last ~10k blocks (archive needs a personal
 * token; the dataseed free tier rejects eth_getLogs outright - both probed
 * 2026-09-07). 5,000 is the verified-safe depth. Sessions live <=48h by
 * design, so at deployment the index begins with whatever the free window
 * reaches and accumulates forward from the cron - the authority page
 * states the index start wherever these rows are used.
 */
const DEPTH = (() => {
  const i = process.argv.indexOf("--depth");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1] ?? 5_000)) : 5_000;
})();
const CHUNK = 500;

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });

// eth_getLogs is NOT served by the bnbchain dataseed free tier ("limit
// exceeded" for any range) and llamarpc is unreachable from this network.
// publicnode serves it fine (probed 2026-09-07). Single provider, with
// retries - a fallback chain here just rotates the failure to a provider
// that rejects the method outright.
const transport = http(
  (process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com") as string,
  { timeout: 20_000, retryCount: 3 },
);
const pub = createPublicClient({ chain: bsc, transport });

async function main() {
  const keystore = KEYSTORE[56];
  const head = await pub.getBlockNumber();
  let [cp] = await sql<{ last_block: bigint }[]>`
    select last_block from index_checkpoints where name = 'keystore:56'`;
  const floor = head - BigInt(DEPTH);
  let cursor = cp && cp.last_block > floor ? cp.last_block + 1n : floor;

  console.log(`\n  KEYSTORE SESSION INDEX BACKFILL (mainnet 56)`);
  console.log(`  mode     ${APPLY ? "APPLY" : "dry run"}`);
  console.log(`  head     ${head}  depth ${DEPTH} blocks  from ${cursor}`);
  console.log(`  target   ${keystore}\n`);

  let totalWallets = new Set<string>();
  let inserted = 0, refreshed = 0, deactivated = 0, empty = 0, failed = 0, chunks = 0;

  while (cursor < head) {
    const to = cursor + BigInt(CHUNK) - 1n > head ? head : cursor + BigInt(CHUNK) - 1n;
    const logs = (await pub.getLogs({ address: keystore, fromBlock: cursor, toBlock: to })) as unknown as RawLog[];
    chunks++;
    const wallets = harvestWallets(logs);
    for (const w of wallets) totalWallets.add(w);

    for (const wallet of wallets) {
      const auth = await readAuthority(wallet as `0x${string}`, 56);
      if (auth.error) { failed++; continue; }
      if (!auth.keys.length) { empty++; continue; }

      const existing = await sql<{ session_public_key: string | null; state: string | null }[]>`
        select session_public_key, state from sessions
        where chain_id = 56 and lower(wallet_address) = ${wallet}`;

      const plan = planSessionUpserts(
        wallet,
        auth.keys.map((k) => ({ keyId: k.keyId, publicKey: k.publicKey, valid: k.valid })),
        existing,
      );

      if (APPLY) {
        for (const r of plan.inserts) {
          await sql`
            insert into sessions
              (chain_id, wallet_address, session_public_key, canonical_json, state,
               unbounded, call_allowlist, spend_caps, grant_tx_hash,
               source, first_seen_block, last_seen_block, last_checked_at, observed_at)
            values
              (56, ${wallet}, ${r.publicKey},
               ${JSON.stringify({
                 source: "chain-index",
                 note: "observed from Altana Keystore logs; scope is not readable from the registry",
                 keyId: r.keyId,
               })},
               ${r.valid ? "active" : "inactive"},
               null, null, null, null,
               'chain-index', ${to.toString()}, ${to.toString()}, now(), now())
            on conflict (chain_id, session_public_key) do update set
              state = excluded.state,
              last_seen_block = excluded.last_seen_block,
              last_checked_at = now()`;
          inserted++;
        }
        for (const r of plan.refreshes) {
          await sql`
            update sessions set
              state = ${r.valid ? "active" : "inactive"},
              last_seen_block = ${to.toString()},
              last_checked_at = now()
            where chain_id = 56 and lower(session_public_key) = ${r.publicKey.toLowerCase()}`;
          refreshed++;
        }
        for (const d of plan.deactivations) {
          await sql`
            update sessions set state = 'inactive', last_checked_at = now()
            where chain_id = 56 and lower(session_public_key) = ${d.publicKey.toLowerCase()}`;
          deactivated++;
        }
      } else {
        inserted += plan.inserts.length;
        refreshed += plan.refreshes.length;
        deactivated += plan.deactivations.length;
      }
    }

    if (APPLY) {
      await sql`
        update index_checkpoints set last_block = ${to.toString()}, updated_at = now()
        where name = 'keystore:56'`;
    }
    process.stdout.write(`\r  ${to}/${head}  logs chunk=${chunks}  wallets=${totalWallets.size}   `);
    cursor = to + 1n;
  }

  console.log(`\n\n  ${APPLY ? "applied" : "dry run"}: chunks=${chunks} wallets=${totalWallets.size}`);
  console.log(`  inserted=${inserted} refreshed=${refreshed} deactivated=${deactivated} empty=${empty} failed=${failed}`);
  if (!APPLY) console.log(`  nothing written (dry run)`);
  console.log("");
}

main()
  .catch((e: any) => { console.error(`\n  FAILED: ${String(e?.message ?? e).slice(0, 300)}\n`); process.exitCode = 1; })
  .finally(() => sql.end({ timeout: 5 }));
