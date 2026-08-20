/**
 * Incremental registry sync, callable on a schedule.
 *
 * Reads only tokens above the stored high-water mark, so a run costs a handful
 * of multicalls rather than re-reading 270k identities. BNB Chain adds roughly
 * 250-350 identities a day, so a five-minute cadence keeps the funnel within
 * minutes of chain state.
 *
 * `data:` pointers are decoded inline because they cost no network call; remote
 * pointers are left for /api/cron/resolve.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { authorizeCron } from "@/lib/cron-auth";
import {
  makeClient, findMaxTokenId, readRange, resolveRegistration, endpointsFromRegistration,
} from "@/lib/registry";
import { lintUrl } from "@/lib/lint";
import { registrableDomain } from "@/lib/operator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_NEW = Number(process.env.CRON_SYNC_MAX_NEW ?? 400);
const BATCH = 200;
const TIME_BUDGET_MS = 45_000;

function clean(v: unknown, max = 300): string | null {
  if (v == null) return null;
  const s = String(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .trim();
  return s.length ? s.slice(0, max) : null;
}

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const startedAt = Date.now();
  const sql = postgres(url, { prepare: false, max: 4, connect_timeout: 10, onnotice: () => {} });

  try {
    const hw = await sql<{ max: string | null }[]>`select max(token_id)::text as max from registry_tokens`;
    const from = BigInt(hw[0]?.max ?? "0") + 1n;

    const client = makeClient();
    const onChainMax = await findMaxTokenId(client, from > 1n ? from : 260_000n);

    if (onChainMax < from) {
      await sql`select public.refresh_census_stats()`;
      return NextResponse.json({
        ok: true, added: 0, storedMax: (from - 1n).toString(),
        onChainMax: onChainMax.toString(), note: "no new identities",
      });
    }

    const target = onChainMax - from + 1n > BigInt(MAX_NEW) ? from + BigInt(MAX_NEW) - 1n : onChainMax;
    let added = 0;

    for (let start = from; start <= target; start += BigInt(BATCH)) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;

      const ids: bigint[] = [];
      for (let i = start; i < start + BigInt(BATCH) && i <= target; i++) ids.push(i);

      let chain;
      try { chain = await readRange(client, ids); } catch { continue; }

      const rows: any[] = [];
      for (const c of chain) {
        let extra: any = {};
        if (c.uriScheme === "data") {
          const res = await resolveRegistration(c.tokenURI);
          if (res.ok) {
            const eps = endpointsFromRegistration(res.file).map((e) => {
              let h: string | null = null, op: string | null = null;
              try { h = new URL(e.url).hostname; op = registrableDomain(h); } catch { /* bad url */ }
              return { ...e, operator: op, fatal: lintUrl(e.url).filter((d) => d.severity === "fatal").map((d) => d.code) };
            });
            extra = {
              resolved: true,
              has_name: !!res.file.name,
              claim_active: res.file.active === true,
              endpoint_count: eps.length,
              callable: eps.some((e) => (e.kind === "a2a" || e.kind === "mcp") && e.fatal.length === 0),
              has_fatal: eps.some((e) => e.fatal.length > 0),
              x402: res.file.x402Support === true,
              trust_models: (res.file.supportedTrust ?? []).map((t) => clean(t, 48)).filter(Boolean),
              operator_domain: clean(eps.map((e) => e.operator).find(Boolean) ?? null, 253),
            };
          }
        }
        rows.push({
          token_id: c.tokenId,
          owner: clean(c.owner, 42),
          uri_scheme: clean(c.uriScheme, 12) ?? "other",
          token_uri: clean(c.tokenURI, 500),
          resolved: false, has_name: false, claim_active: false,
          endpoint_count: 0, callable: false, has_fatal: false, x402: false,
          trust_models: [], operator_domain: null, resolve_error: null,
          ...extra,
        });
      }

      if (rows.length) {
        await sql`
          insert into registry_tokens ${sql(rows)}
          on conflict (token_id) do update set
            owner = excluded.owner,
            uri_scheme = excluded.uri_scheme,
            token_uri = coalesce(excluded.token_uri, registry_tokens.token_uri),
            resolved = excluded.resolved or registry_tokens.resolved,
            has_name = excluded.has_name or registry_tokens.has_name,
            claim_active = excluded.claim_active,
            endpoint_count = greatest(excluded.endpoint_count, registry_tokens.endpoint_count),
            callable = excluded.callable or registry_tokens.callable,
            has_fatal = excluded.has_fatal,
            x402 = excluded.x402,
            checked_at = now()
        `;
        added += rows.length;
      }
    }

    await sql`select public.refresh_census_stats()`;

    return NextResponse.json({
      ok: true, added,
      storedMax: (from - 1n).toString(),
      onChainMax: onChainMax.toString(),
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
