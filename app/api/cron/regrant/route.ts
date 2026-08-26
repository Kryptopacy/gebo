/**
 * Cron endpoint: re-grant Altana demo sessions to keep them live for judging.
 *
 * Sessions expire <=48h by design (limiting demo key exposure). This endpoint
 * re-grants all four judged-category sessions, called by pg_cron via pg_net
 * on the dates that matter for hackathon judging.
 *
 * The grant script's duplicate detection (grant-demo-sessions.ts) skips
 * sessions whose canonical_json matches an existing non-expired row, so
 * running this multiple times is safe — it only writes when a session has
 * actually expired.
 *
 * Required Vercel env: DATABASE_URL, DEMO_OWNER_PRIVATE_KEY, CRON_SECRET,
 *                      plus @altananetwork/sdk + viem in package.json.
 */
import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const pk = process.env.DEMO_OWNER_PRIVATE_KEY;
  const url = process.env.DATABASE_URL;
  if (!pk || !url) {
    return NextResponse.json(
      { ok: false, error: "DEMO_OWNER_PRIVATE_KEY or DATABASE_URL not set" },
      { status: 503 },
    );
  }

  const startedAt = Date.now();

  try {
    // Dynamic import avoids top-level SDK load when the endpoint is just being
    // imported for type checking or test stubs.
    const [{ default: postgres }, { createClient: createAltanaClient, BNB, signerFromPrivateKey }, viem, scope] =
      await Promise.all([
        import("postgres"),
        import("@altananetwork/sdk"),
        import("viem"),
        import("../../../../src/lib/session-scope.ts"),
      ] as const);

    const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
    const { PRESETS, buildPermissions, canonicalise } = scope;
    const { createPublicClient, http, formatEther } = viem;
    const { bsc } = await import("viem/chains");

    const rpc = process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com";
    const pub = createPublicClient({ chain: bsc, transport: http(rpc, { timeout: 30_000 }) });
    const client = createAltanaClient({ chains: [BNB] });
    const signer = signerFromPrivateKey(pk as `0x${string}`);
    const wallet = await client.createWallet({ signer });
    const owner = wallet.address as `0x${string}`;
    const bal = await pub.getBalance({ address: owner });
    const balEther = formatEther(bal);

    if (bal === 0n) {
      await sql.end();
      return NextResponse.json({ ok: false, error: `wallet ${owner} has no gas (${balEther} BNB)` }, { status: 503 });
    }

    const CHAIN_ID = 56;
    const MAX_EXPIRY_HOURS = 48;

    const PLAN = [
      { category: "rebalancing", presetId: "conservative" },
      { category: "grid",        presetId: "conservative" },
      { category: "yield",       presetId: "conservative" },
      { category: "health",      presetId: "standard" },
    ] as const;

    const results: { category: string; status: string; info?: string }[] = [];
    let granted = 0, skipped = 0, failed = 0;

    for (const { category, presetId } of PLAN) {
      const presets = PRESETS[category];
      const base = presets?.find((p: any) => p.id === presetId);
      if (!base) {
        results.push({ category, status: "error", info: `no preset ${presetId}` });
        failed++;
        continue;
      }
      const preset = { ...base, expiryHours: Math.min(base.expiryHours, MAX_EXPIRY_HOURS) };
      const perms = buildPermissions(preset);
      const canonical = canonicalise(perms);

      const existing = await sql<{ id: number }[]>`
        select id from sessions
        where chain_id = ${CHAIN_ID} and canonical_json = ${canonical}
          and state = 'active' and expiry > now()`;

      if (existing[0]) {
        results.push({ category, status: "skipped", info: `session #${existing[0].id} still valid` });
        skipped++;
        continue;
      }

      const expirySec = Math.floor(Date.now() / 1000) + preset.expiryHours * 3600;
      try {
        const sdkCalls = perms.calls.map(
          (c: any) => ({ to: c.to }) as { to: NonNullable<typeof c.to> },
        );
        const session = await client.grantSession({
          wallet,
          signer,
          permissions: {
            calls: sdkCalls as any,
            spend: perms.spend.map((s: any) => ({
              limit: s.limit, period: s.period, ...(s.token ? { token: s.token } : {}),
            })),
          },
          expiry: expirySec,
        });

        const txHash = (session as { transactionHash?: string }).transactionHash ?? null;
        const spendJson = perms.spend.map((s: any) => ({
          limit: s.limit.toString(), period: s.period,
          ...(s.token ? { token: s.token.toLowerCase() } : {}),
          symbol: s.symbol, decimals: s.decimals, humanAmount: s.humanAmount,
        }));

        await sql`
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
            observed_at = now()`;

        granted++;
        results.push({
          category,
          status: "granted",
          info: `expires ${new Date(session.expiry * 1000).toISOString()}, tx ${txHash ?? "pending"}`,
        });
      } catch (e: any) {
        failed++;
        results.push({ category, status: "failed", info: String(e?.shortMessage ?? e?.message ?? e).slice(0, 120) });
      }
    }

    await sql.end();

    return NextResponse.json({
      ok: granted > 0 || skipped >= 4,
      wallet: owner,
      balance: `${balEther} BNB`,
      granted,
      skipped,
      failed,
      results,
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err).slice(0, 300) },
      { status: 500 },
    );
  }
}
