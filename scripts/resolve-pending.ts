/**
 * Resolve pending registrations, working from the database rather than a file.
 *
 * The registry sync decodes `data:` URIs inline because they cost no network
 * call. Remote pointers are deferred, and there are roughly 100k of them, so
 * this job chews through a bounded slice per run and accumulates coverage.
 *
 * Per-host pacing is not optional here: one operator accounts for around 80% of
 * all metadata URLs, so an unpaced run would look like a denial-of-service
 * attempt against a single origin.
 *
 * Failures increment resolve_attempts, so a permanently dead host drops out of
 * the queue instead of being retried forever.
 */
import "dotenv/config";
import postgres from "postgres";
import { resolveRegistration, endpointsFromRegistration } from "../src/lib/registry.ts";
import { lintUrl } from "../src/lib/lint.ts";
import { registrableDomain } from "../src/lib/operator.ts";

const LIMIT = Number(process.argv.includes("--limit") ? process.argv[process.argv.indexOf("--limit") + 1] : 8000);
const CONCURRENCY = Number(process.env.RESOLVE_CONCURRENCY ?? 20);
const HOST_GAP_MS = Number(process.env.HOST_GAP_MS ?? 250);
const MAX_ATTEMPTS = 3;

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 5, connect_timeout: 25, onnotice: () => {} });

function clean(v: unknown, max = 300): string | null {
  if (v == null) return null;
  const s = String(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .trim();
  return s.length ? s.slice(0, max) : null;
}

type Pending = { token_id: string; token_uri: string; uri_scheme: string };

console.log("");

try {
  const pending = await sql<Pending[]>`
    select token_id::text as token_id, token_uri, uri_scheme
    from registry_tokens
    where resolved = false
      and uri_scheme in ('https', 'http', 'ipfs')
      and token_uri is not null
      and resolve_attempts < ${MAX_ATTEMPTS}
    order by resolve_attempts asc, token_id desc
    limit ${LIMIT}
  `;

  const pendingCount = await sql<{ n: number }[]>`
    select count(*)::int as n from registry_tokens
    where resolved = false and uri_scheme in ('https','http','ipfs')
      and token_uri is not null and resolve_attempts < ${MAX_ATTEMPTS}
  `;
  const totalPending = pendingCount[0]?.n ?? 0;

  console.log(`  pending overall     ${totalPending.toLocaleString()}`);
  console.log(`  this run            ${pending.length.toLocaleString()}`);

  if (!pending.length) {
    console.log(`\n  nothing to resolve — exiting cleanly\n`);
    await sql`select public.refresh_census_stats()`;
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  const hosts = new Map<string, number>();
  for (const p of pending) {
    try { const h = new URL(p.token_uri).hostname; hosts.set(h, (hosts.get(h) ?? 0) + 1); } catch { /* ipfs */ }
  }
  console.log(`  distinct hosts      ${hosts.size}`);
  for (const [h, n] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`    ${String(n).padStart(6)}  ${h}`);
  }
  console.log("");

  const hostNext = new Map<string, number>();
  async function politeWait(host: string | null) {
    if (!host) return;
    const now = Date.now();
    const next = Math.max(hostNext.get(host) ?? 0, now);
    hostNext.set(host, next + HOST_GAP_MS);
    if (next > now) await new Promise((r) => setTimeout(r, next - now));
  }

  const tally = { ok: 0, fail: 0, endpoints: 0, callable: 0 };
  const t0 = Date.now();
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= pending.length) return;
      const p = pending[i]!;

      let host: string | null = null;
      try { host = new URL(p.token_uri).hostname; } catch { /* ipfs:// */ }
      await politeWait(host);

      const res = await resolveRegistration(p.token_uri, 9000);
      done++;

      if (!res.ok) {
        tally.fail++;
        await sql`
          update registry_tokens
          set resolve_attempts = resolve_attempts + 1,
              resolve_error = ${clean(res.error, 200)},
              checked_at = now()
          where token_id = ${p.token_id}
        `;
      } else {
        tally.ok++;
        const eps = endpointsFromRegistration(res.file).map((e) => {
          let h: string | null = null, op: string | null = null;
          try { h = new URL(e.url).hostname; op = registrableDomain(h); } catch { /* bad url */ }
          return { ...e, host: h, operator: op, fatal: lintUrl(e.url).filter((d) => d.severity === "fatal").map((d) => d.code) };
        });
        if (eps.length) tally.endpoints++;
        const callable = eps.some((e) => (e.kind === "a2a" || e.kind === "mcp") && e.fatal.length === 0);
        if (callable) tally.callable++;
        const firstOp = eps.map((e) => e.operator).find(Boolean) ?? null;

        await sql`
          update registry_tokens set
            resolved = true,
            resolve_error = null,
            has_name = ${!!res.file.name},
            claim_active = ${res.file.active === true},
            endpoint_count = ${eps.length},
            callable = ${callable},
            has_fatal = ${eps.some((e) => e.fatal.length > 0)},
            x402 = ${res.file.x402Support === true},
            trust_models = ${(res.file.supportedTrust ?? []).map((t) => clean(t, 48)).filter(Boolean) as string[]},
            operator_domain = ${clean(firstOp, 253)},
            checked_at = now()
          where token_id = ${p.token_id}
        `;
      }

      if (done % 500 === 0) {
        const mins = (Date.now() - t0) / 60_000;
        console.log(
          `    ${done.toLocaleString()}/${pending.length.toLocaleString()}  ${(done / Math.max(mins, 0.01)).toFixed(0)}/min  ` +
          `ok=${tally.ok} fail=${tally.fail} endpoints=${tally.endpoints} callable=${tally.callable}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n  RESOLVED — ${done.toLocaleString()} in ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
  console.log(`  ok                  ${tally.ok.toLocaleString()}`);
  console.log(`  failed              ${tally.fail.toLocaleString()}`);
  console.log(`  declare an endpoint ${tally.endpoints.toLocaleString()}`);
  console.log(`  callable            ${tally.callable.toLocaleString()}`);

  await sql`select public.refresh_census_stats()`;
  const [s] = await sql<any[]>`
    select resolved, with_endpoint, callable, operators from census_stats where id = 'bsc'`;
  if (s) {
    console.log(`\n  funnel now: resolved=${Number(s.resolved).toLocaleString()} ` +
      `endpoint=${Number(s.with_endpoint).toLocaleString()} ` +
      `callable=${Number(s.callable).toLocaleString()} operators=${s.operators}`);
  }
  console.log("");
} catch (e: any) {
  console.error(`\n  RESOLVE FAILED: ${String(e?.message ?? e).slice(0, 300)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 10 });
}
