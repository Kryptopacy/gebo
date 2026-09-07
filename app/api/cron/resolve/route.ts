/**
 * Bounded registration-resolution slice, callable on a schedule.
 *
 * Why a route and not a CI job: GitHub Actions is unavailable (account billing
 * lock) and Vercel Hobby caps cron at once daily, which cannot keep ~100k
 * pending registrations moving. Supabase ships pg_cron and pg_net on every
 * tier, so the database can call this endpoint every minute — no external CI,
 * no plan upgrade, and the schedule lives beside the data it maintains.
 *
 * Sized to finish well inside the serverless limit. Called once a minute a
 * 120-row slice clears roughly 170k registrations a day, which is more than the
 * backlog.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { authorizeCron } from "@/lib/cron-auth";
import { resolveRegistration, endpointsFromRegistration } from "@/lib/registry";
import { lintUrl } from "@/lib/lint";
import { registrableDomain } from "@/lib/operator";
import { refreshCensusStatsIfDue } from "@/lib/census-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SLICE = Number(process.env.CRON_RESOLVE_SLICE ?? 120);
const CONCURRENCY = 14;
const HOST_GAP_MS = 220;
const MAX_ATTEMPTS = 3;
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

type Pending = { token_id: string; token_uri: string };

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const startedAt = Date.now();
  const sql = postgres(url, { prepare: false, max: 5, connect_timeout: 10, onnotice: () => {} });

  try {
    const pending = await sql<Pending[]>`
      select token_id::text as token_id, token_uri
      from registry_tokens
      where resolved = false
        and uri_scheme in ('https', 'http', 'ipfs')
        and token_uri is not null
        and resolve_attempts < ${MAX_ATTEMPTS}
      order by resolve_attempts asc, token_id desc
      limit ${SLICE}
    `;

    if (!pending.length) {
      // Nothing left: keep the published funnel in step with stored rows.
      await sql`select public.refresh_census_stats()`;
      return NextResponse.json({ ok: true, resolved: 0, note: "backlog clear" });
    }

    const hostNext = new Map<string, number>();
    const tally = { ok: 0, fail: 0, endpoints: 0, callable: 0 };
    let cursor = 0;

    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= pending.length) return;
        if (Date.now() - startedAt > TIME_BUDGET_MS) return;

        const p = pending[i]!;
        let host: string | null = null;
        try { host = new URL(p.token_uri).hostname; } catch { /* ipfs:// */ }

        // One operator hosts ~80% of metadata URLs; unpaced this looks hostile.
        if (host) {
          const now = Date.now();
          const next = Math.max(hostNext.get(host) ?? 0, now);
          hostNext.set(host, next + HOST_GAP_MS);
          if (next > now) await new Promise((r) => setTimeout(r, next - now));
        }

        const res = await resolveRegistration(p.token_uri, 8000);

        if (!res.ok) {
          tally.fail++;
          await sql`
            update registry_tokens
            set resolve_attempts = resolve_attempts + 1,
                resolve_error = ${clean(res.error, 200)},
                checked_at = now()
            where token_id = ${p.token_id}
          `;
          continue;
        }

        tally.ok++;
        const eps = endpointsFromRegistration(res.file).map((e) => {
          let h: string | null = null, op: string | null = null;
          try { h = new URL(e.url).hostname; op = registrableDomain(h); } catch { /* bad url */ }
          return { ...e, host: h, operator: op, fatal: lintUrl(e.url).filter((d) => d.severity === "fatal").map((d) => d.code) };
        });
        if (eps.length) tally.endpoints++;
        const callable = eps.some((e) => (e.kind === "a2a" || e.kind === "mcp") && e.fatal.length === 0);
        if (callable) tally.callable++;

        await sql`
          update registry_tokens set
            resolved = true, resolve_error = null,
            has_name = ${!!res.file.name},
            claim_active = ${res.file.active === true},
            endpoint_count = ${eps.length},
            callable = ${callable},
            has_fatal = ${eps.some((e) => e.fatal.length > 0)},
            x402 = ${res.file.x402Support === true},
            trust_models = ${(res.file.supportedTrust ?? []).map((t) => clean(t, 48)).filter(Boolean) as string[]},
            operator_domain = ${clean(eps.map((e) => e.operator).find(Boolean) ?? null, 253)},
            checked_at = now()
          where token_id = ${p.token_id}
        `;
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // changed=false when nothing resolved: a no-op pass must not pay for a
    // full-table stats aggregation (see census-refresh.ts).
    const resolvedAny = pending.length > 0;
    const refresh = await refreshCensusStatsIfDue(sql, { changed: resolvedAny });

    const remaining = await sql<{ n: number }[]>`
      select count(*)::int as n from registry_tokens
      where resolved = false and uri_scheme in ('https','http','ipfs')
        and token_uri is not null and resolve_attempts < ${MAX_ATTEMPTS}
    `;

    return NextResponse.json({
      ok: true,
      attempted: tally.ok + tally.fail,
      resolved: tally.ok,
      failed: tally.fail,
      withEndpoint: tally.endpoints,
      callable: tally.callable,
      remaining: remaining[0]?.n ?? 0,
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
