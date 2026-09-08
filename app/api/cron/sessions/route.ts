/**
 * Keystore session indexing cron: harvest wallets from recent Keystore logs
 * on mainnet and upsert their current session keys into public.sessions.
 *
 * Until this route existed, public.sessions held only GEBO's own demo
 * grants - the authority console could not show third-party sessions, and
 * AGENTS.md recorded "no reverse index from session key to wallet" as a
 * known gap. The Keystore emits events for every register/revoke, so the
 * logs are the discovery layer; the truth per wallet comes from
 * readAuthority() (getKeys + isValidKey + getPublicKey), the same read the
 * authority console itself runs.
 *
 * Bounded windows via public.index_checkpoints: each run advances the
 * checkpoint by at most MAX_BLOCKS_PER_RUN blocks, so a long gap heals over
 * consecutive runs rather than one unbounded getLogs.
 *
 * Honesty rules carried from src/lib/session-index.ts: empty getKeys ->
 * skipped wallet; keys absent from getKeys -> rows marked inactive with the
 * check time, never deleted; scope fields stay null for third-party keys
 * because the Keystore exposes no getter for them.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { createPublicClient, http, fallback, type Hex } from "viem";
import { bsc } from "viem/chains";
import { authorizeCron } from "@/lib/cron-auth";
import { KEYSTORE, readAuthority } from "@/lib/keystore";
import { harvestWallets, planSessionUpserts, type RawLog } from "@/lib/session-index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BLOCKS_PER_RUN = 5_000;
const MAX_NEW_WALLETS_PER_RUN = 40;
const SAFETY_BLOCKS = 5;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const startedAt = Date.now();
  const sql = postgres(url, { prepare: false, max: 3, connect_timeout: 10, onnotice: () => {} });

  try {
    // eth_getLogs is NOT served by the bnbchain dataseed free tier at any
    // range, and publicnode serves only the last ~10k blocks ("archive
    // requests require a personal token", probed 2026-09-07). One provider,
    // windowed inside that limit - the bounded-window design below already
    // stays within it, and the 10-minute cadence at ~0.5s BSC blocks uses
    // well under a tenth of the allowance per run.
    const transport = http(
      (process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com") as string,
      { timeout: 15_000, retryCount: 2 },
    );
    const pub = createPublicClient({ chain: bsc, transport });
    const keystore = KEYSTORE[56] as `0x${string}`;

    const head = await pub.getBlockNumber();
    const toBlock = head - BigInt(SAFETY_BLOCKS);

    let [cp] = await sql<{ last_block: bigint }[]>`
      select last_block from index_checkpoints where name = 'keystore:56'`;
    if (!cp) {
      // First run: start from a bounded recent window (MAX_BLOCKS_PER_RUN),
      // NOT from genesis - the backfill script owns deeper history.
      // last_block is bigint in SQL; the interpolated value is a string to
      // keep postgres.js's parameter typing happy (bigint params land in
      // the never overload).
      await sql`
        insert into index_checkpoints (name, last_block)
        values ('keystore:56', ${(toBlock - BigInt(MAX_BLOCKS_PER_RUN)).toString()})
        on conflict (name) do nothing`;
      [cp] = await sql<{ last_block: bigint }[]>`
        select last_block from index_checkpoints where name = 'keystore:56'`;
    }
    const fromBlock = cp!.last_block + 1n;
    if (fromBlock > toBlock) {
      return NextResponse.json({ ok: true, note: "up to date", head: head.toString(), ms: Date.now() - startedAt });
    }
    const windowEnd = fromBlock + BigInt(MAX_BLOCKS_PER_RUN) - 1n < toBlock
      ? fromBlock + BigInt(MAX_BLOCKS_PER_RUN) - 1n
      : toBlock;

    const logs = (await pub.getLogs({
      address: keystore,
      fromBlock,
      toBlock: windowEnd,
    })) as unknown as RawLog[];

    const wallets = harvestWallets(logs);

    // Known wallets refresh; unknown ones are capped per run so a burst in
    // the window cannot blow the time budget.
    const known = new Set(
      (await sql<{ wallet_address: string }[]>`
        select distinct wallet_address from sessions where chain_id = 56`
      ).map((r) => r.wallet_address.toLowerCase()),
    );
    const todo = wallets.filter((w) => known.has(w)).concat(
      wallets.filter((w) => !known.has(w)).slice(0, MAX_NEW_WALLETS_PER_RUN),
    );

    let inserted = 0, refreshed = 0, deactivated = 0, empty = 0, failed = 0;

    for (const wallet of todo) {
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
             'chain-index', ${windowEnd.toString()}, ${windowEnd.toString()}, now(), now())
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
            last_seen_block = ${windowEnd.toString()},
            last_checked_at = now()
          where chain_id = 56 and lower(session_public_key) = ${r.publicKey.toLowerCase()}`;
        refreshed++;
      }
      for (const d of plan.deactivations) {
        await sql`
          update sessions set
            state = 'inactive',
            last_checked_at = now()
          where chain_id = 56 and lower(session_public_key) = ${d.publicKey.toLowerCase()}`;
        deactivated++;
      }
    }

    await sql`
      update index_checkpoints set last_block = ${windowEnd.toString()}, updated_at = now()
      where name = 'keystore:56'`;

    return NextResponse.json({
      ok: true,
      window: `${fromBlock}-${windowEnd}`,
      logs: logs.length,
      walletsSeen: wallets.length,
      processed: todo.length,
      inserted, refreshed, deactivated, empty, failed,
      remainingBlocks: Number(toBlock - windowEnd),
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
