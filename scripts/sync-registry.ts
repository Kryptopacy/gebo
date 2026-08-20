/**
 * Incremental registry sync.
 *
 * Replaces the "run a 2-hour census by hand, then transcribe the numbers"
 * workflow with something a scheduler can own.
 *
 *   --backfill   one-off: load the existing 144 MB NDJSON into registry_tokens
 *   (default)    read only tokens above the stored high-water mark from chain
 *
 * The registry only grows and existing tokenURIs rarely change, so a scheduled
 * run reads a few hundred new tokens rather than 270k. Afterwards it calls
 * refresh_census_stats(), so the funnel on the site is a SQL aggregate over
 * stored rows — no hardcoded figure, no local file, nothing hand-copied.
 */
import "dotenv/config";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import postgres from "postgres";
import {
  makeClient, findMaxTokenId, readRange, resolveRegistration,
  endpointsFromRegistration,
} from "../src/lib/registry.ts";
import { lintUrl } from "../src/lib/lint.ts";
import { registrableDomain } from "../src/lib/operator.ts";

const BACKFILL = process.argv.includes("--backfill");
const BATCH = 250;
const MAX_NEW = Number(process.env.SYNC_MAX_NEW ?? 5000);

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 4, connect_timeout: 25, onnotice: () => {} });

/** Strip bytes Postgres text rejects — registration files are untrusted input. */
function clean(v: unknown, max = 300): string | null {
  if (v == null) return null;
  const s = String(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .trim();
  return s.length ? s.slice(0, max) : null;
}

type TokenRow = {
  token_id: string;
  owner: string | null;
  uri_scheme: string;
  resolved: boolean;
  has_name: boolean;
  claim_active: boolean;
  endpoint_count: number;
  callable: boolean;
  has_fatal: boolean;
  x402: boolean;
  trust_models: string[] | null;
  operator_domain: string | null;
  token_uri: string | null;
  resolve_error: string | null;
};

async function upsert(rows: TokenRow[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await sql`
      insert into registry_tokens ${sql(rows.slice(i, i + 500) as any)}
      on conflict (token_id) do update set
        owner = excluded.owner,
        uri_scheme = excluded.uri_scheme,
        resolved = excluded.resolved,
        has_name = excluded.has_name,
        claim_active = excluded.claim_active,
        endpoint_count = excluded.endpoint_count,
        callable = excluded.callable,
        has_fatal = excluded.has_fatal,
        x402 = excluded.x402,
        trust_models = excluded.trust_models,
        operator_domain = excluded.operator_domain,
        token_uri = coalesce(excluded.token_uri, registry_tokens.token_uri),
        resolve_error = excluded.resolve_error,
        checked_at = now()
    `;
  }
}

function toRow(r: any): TokenRow {
  const eps = (r.endpoints ?? []) as { kind: string; url: string; host?: string | null; operator?: string | null; fatal?: string[] }[];
  const firstOp = eps
    .map((e) => e.operator ?? (e.host ? registrableDomain(e.host) : null))
    .find(Boolean) ?? null;
  const fatal = eps.some((e) => (e.fatal ?? []).length > 0);
  return {
    token_id: String(r.tokenId ?? r.token_id),
    owner: clean(r.owner, 42),
    uri_scheme: clean(r.uriScheme, 12) ?? "other",
    resolved: !!r.resolved,
    has_name: !!r.regName,
    claim_active: r.regActive === true,
    endpoint_count: eps.length,
    callable: !!r.callable,
    has_fatal: fatal,
    x402: r.x402 === true,
    trust_models: (r.supportedTrust ?? []).map((t: unknown) => clean(t, 48)).filter(Boolean) as string[],
    operator_domain: clean(firstOp, 253),
    token_uri: clean(r.tokenURI ?? r.token_uri, 500),
    resolve_error: clean(r.resolveError, 200),
  };
}

console.log("");

try {
  if (BACKFILL) {
    // ── one-off: seed from the files the manual census already produced ────
    let loaded = 0;
    let buffer: TokenRow[] = [];
    const seen = new Set<string>();

    for (const file of ["data/registry-bsc.ndjson", "data/registry-remote.ndjson"]) {
      if (!existsSync(file)) { console.log(`  skip (missing) ${file}`); continue; }
      const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        let r: any;
        try { r = JSON.parse(line); } catch { continue; }
        const row = toRow(r);
        // Later files win: the remote pass resolves what the local pass deferred.
        if (seen.has(row.token_id) && !row.resolved) continue;
        seen.add(row.token_id);
        buffer.push(row);
        if (buffer.length >= 500) {
          await upsert(buffer); loaded += buffer.length; buffer = [];
          if (loaded % 25_000 === 0) console.log(`    backfilled ${loaded.toLocaleString()}`);
        }
      }
      console.log(`  read ${file}`);
    }
    if (buffer.length) { await upsert(buffer); loaded += buffer.length; }
    console.log(`  backfilled          ${loaded.toLocaleString()} tokens`);
  } else {
    // ── scheduled: read only what is new on chain ─────────────────────────
    const [hw] = await sql<{ max: string | null }[]>`select max(token_id)::text as max from registry_tokens`;
    const from = BigInt(hw?.max ?? "0") + 1n;

    const client = makeClient();
    const onChainMax = await findMaxTokenId(client, from > 1n ? from : 260_000n);
    console.log(`  stored high-water   ${(from - 1n).toLocaleString()}`);
    console.log(`  on-chain max        ${onChainMax.toLocaleString()}`);

    if (onChainMax < from) {
      console.log(`  nothing new to read`);
    } else {
      const target = onChainMax - from + 1n > BigInt(MAX_NEW) ? from + BigInt(MAX_NEW) - 1n : onChainMax;
      console.log(`  reading             ${from.toLocaleString()} → ${target.toLocaleString()}`);

      let added = 0;
      for (let start = from; start <= target; start += BigInt(BATCH)) {
        const ids: bigint[] = [];
        for (let i = start; i < start + BigInt(BATCH) && i <= target; i++) ids.push(i);

        let chain;
        try { chain = await readRange(client, ids); }
        catch (e: any) { console.log(`    ! batch ${start} failed: ${String(e?.shortMessage ?? e).slice(0, 70)}`); continue; }

        const rows: TokenRow[] = [];
        for (const c of chain) {
          // Resolve data: URIs inline (no network); defer remote to the resolver.
          let extra: any = {};
          if (c.uriScheme === "data") {
            const res = await resolveRegistration(c.tokenURI);
            if (res.ok) {
              const eps = endpointsFromRegistration(res.file).map((e) => {
                let host: string | null = null, op: string | null = null;
                try { host = new URL(e.url).hostname; op = registrableDomain(host); } catch { /* bad url */ }
                return { ...e, host, operator: op, fatal: lintUrl(e.url).filter((d) => d.severity === "fatal").map((d) => d.code) };
              });
              extra = {
                resolved: true, regName: res.file.name, regActive: res.file.active,
                x402: res.file.x402Support, supportedTrust: res.file.supportedTrust,
                endpoints: eps,
                callable: eps.some((e) => (e.kind === "a2a" || e.kind === "mcp") && e.fatal.length === 0),
              };
            }
          }
          rows.push(toRow({ ...c, ...extra }));
        }
        await upsert(rows);
        added += rows.length;
        console.log(`    +${rows.length}  total ${added.toLocaleString()}`);
      }
      console.log(`  new tokens stored   ${added.toLocaleString()}`);
    }
  }

  // ── recompute the funnel from stored rows ───────────────────────────────
  console.log(`\n  refreshing census_stats from registry_tokens…`);
  await sql`select public.refresh_census_stats()`;

  const [s] = await sql<any[]>`
    select tokens_minted, censused, resolved, claim_active, with_endpoint, callable,
           operators, owners, largest_operator_share, measured_at
    from census_stats where id = 'bsc'
  `;
  if (s) {
    const n = (v: any) => Number(v ?? 0).toLocaleString();
    console.log(`    minted            ${n(s.tokens_minted)}`);
    console.log(`    censused          ${n(s.censused)}`);
    console.log(`    resolved          ${n(s.resolved)}`);
    console.log(`    claim active      ${n(s.claim_active)}`);
    console.log(`    with endpoint     ${n(s.with_endpoint)}`);
    console.log(`    callable          ${n(s.callable)}`);
    console.log(`    operators         ${n(s.operators)}`);
    console.log(`    owners            ${n(s.owners)}`);
    console.log(`    largest operator  ${s.largest_operator_share}%`);
  }

  const [size] = await sql<{ s: string }[]>`select pg_size_pretty(pg_database_size(current_database())) as s`;
  console.log(`\n  database size       ${size!.s}\n`);
} catch (e: any) {
  console.error(`\n  SYNC FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
  if (e?.detail) console.error(`  detail: ${String(e.detail).slice(0, 200)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 10 });
}
