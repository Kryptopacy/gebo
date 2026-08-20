/**
 * Load the registry census into Supabase — selectively.
 *
 * Deliberate decision: do NOT load all 270,200 identities. The overwhelming
 * majority declare no endpoint, so they are never browsable and never rankable.
 * Storing them would consume roughly 100 MB of a 500 MB tier to display nothing.
 *
 * So this loads the rows that can actually be shown or hired:
 *   - anything declaring at least one endpoint (A2A, MCP or web)
 *   - plus a capped sample of endpoint-less identities, so the UI can show what
 *     a farm registration looks like rather than only describing it
 *
 * The population figures behind the funnel come from scripts/analyse-census.ts
 * and live in the CENSUS constant. Aggregates do not need per-row storage.
 *
 * Sources, merged:
 *   data/registry-bsc.ndjson     full chain census (data: URIs resolved inline)
 *   data/registry-remote.ndjson  second pass, https:/ipfs: registrations
 */
import "dotenv/config";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import postgres from "postgres";
import { registrableDomain } from "../src/lib/operator.ts";

const CHAIN_ID = 56;
const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const SAMPLE_EMPTY = 400;

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }

const sql = postgres(url, { prepare: false, max: 4, connect_timeout: 30, onnotice: () => {} });

type Ep = { kind: string; url: string; version?: string; host: string | null; operator: string | null; fatal: string[] };
type Row = {
  tokenId: string; owner: string | null; tokenURI: string | null; uriScheme: string;
  resolved?: boolean; resolveError?: string | null; regName?: string | null;
  regActive?: boolean | null; x402?: boolean | null; supportedTrust?: string[] | null;
  endpoints?: Ep[]; callable?: boolean;
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  rebalancing: ["rebalanc", "liquidity", "lp ", "concentrated", "range", "pancake", "uniswap", "pool"],
  grid: ["grid", "dca", "market mak", "spread", "band", "scalp", "arbitrage"],
  yield: ["yield", "apy", "apr", "farm", "vault", "stake", "staking", "optimi", "compound", "lend", "venus", "aave", "lista"],
  health: ["health factor", "liquidat", "collateral", "ltv", "borrow", "debt", "loan", "monitor"],
};

function classify(text: string) {
  const hay = (text ?? "").toLowerCase();
  let best: { category: string; matched: string[] } | null = null;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    const matched = kws.filter((k) => hay.includes(k));
    if (matched.length && (!best || matched.length > best.matched.length)) best = { category: cat, matched };
  }
  return best;
}

/**
 * Strip bytes Postgres `text` cannot store.
 *
 * Registration files are attacker-controlled and some contain NUL bytes, which
 * Postgres rejects outright with 'invalid byte sequence for encoding "UTF8":
 * 0x00' — aborting the whole batch. Lone surrogates are also removed because
 * they break JSON round-tripping into jsonb.
 */
function clean(v: string | null | undefined, max = 400): string | null {
  if (v == null) return null;
  const s = String(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .trim();
  return s.length ? s.slice(0, max) : null;
}

/** Trust state before any probe: lint decides SHADOWED, otherwise DORMANT. */
function preProbeState(r: Row): { state: string; reason: string } {
  const fatal = (r.endpoints ?? []).flatMap((e) => e.fatal ?? []);
  if (fatal.length) {
    const code = fatal[0]!;
    return {
      state: "SHADOWED",
      reason: code === "template_var"
        ? "registration contains an unsubstituted template variable — uncallable by any client"
        : code === "placeholder_domain"
          ? "endpoint points at a placeholder domain"
          : code === "loopback_host"
            ? "endpoint points at localhost — unreachable from anywhere else"
            : `fatal registration defect: ${code}`,
    };
  }
  if (!(r.endpoints ?? []).length) {
    return { state: "DORMANT", reason: r.tokenURI ? "declares no service endpoint" : "registered with no metadata pointer" };
  }
  return { state: "DORMANT", reason: "declares an endpoint; not yet probed" };
}

// ── collect ────────────────────────────────────────────────────────────────
const keep = new Map<string, Row>();
const opSeen = new Map<string, { key: string; kind: string; domain: string; label: string }>();
let scanned = 0;
let emptySampled = 0;

async function ingest(file: string) {
  if (!existsSync(file)) { console.log(`  skip (missing) ${file}`); return; }
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let r: Row;
    try { r = JSON.parse(line); } catch { continue; }
    n++; scanned++;

    const eps = r.endpoints ?? [];
    const hasEp = eps.length > 0;

    if (!hasEp) {
      // Keep a bounded sample so the product can show a farm registration.
      if (emptySampled >= SAMPLE_EMPTY) continue;
      emptySampled++;
    }

    // Later file wins — the remote pass has strictly better data than a deferral.
    const prev = keep.get(r.tokenId);
    if (prev && (prev.endpoints?.length ?? 0) > eps.length) continue;
    keep.set(r.tokenId, r);

    for (const e of eps) {
      const dom = e.operator ?? (e.host ? registrableDomain(e.host) : null);
      if (!dom) continue;
      const key = `host:${dom}`;
      if (!opSeen.has(key)) opSeen.set(key, { key, kind: "host", domain: dom, label: dom });
    }
  }
  console.log(`  read ${n.toLocaleString()} rows from ${file}`);
}

console.log("");
await ingest("data/registry-bsc.ndjson");
await ingest("data/registry-remote.ndjson");

const rows = [...keep.values()];
const withEp = rows.filter((r) => (r.endpoints?.length ?? 0) > 0).length;
console.log(`\n  scanned            ${scanned.toLocaleString()}`);
console.log(`  loading            ${rows.length.toLocaleString()}  (${withEp.toLocaleString()} with endpoints + ${emptySampled} sampled empties)`);
console.log(`  operators          ${opSeen.size.toLocaleString()}`);

// ── write ──────────────────────────────────────────────────────────────────
try {
  if (opSeen.size) {
    const ops = [...opSeen.values()];
    for (let i = 0; i < ops.length; i += 300) {
      await sql`
        insert into operators ${sql(ops.slice(i, i + 300).map((o) => ({
          key: o.key, kind: o.kind, registrable_domain: o.domain, label: o.label,
        })))}
        on conflict (key) do update set
          registrable_domain = excluded.registrable_domain,
          label = excluded.label,
          updated_at = now()
      `;
    }
  }
  console.log(`  operators written  ${opSeen.size}`);

  let wrote = 0;
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300).map((r) => {
      const st = preProbeState(r);
      const cls = classify(r.regName ?? "");
      const firstOp = (r.endpoints ?? []).map((e) => e.operator ?? (e.host ? registrableDomain(e.host) : null)).find(Boolean);
      return {
        chain_id: CHAIN_ID,
        token_id: r.tokenId,
        registry: REGISTRY,
        agent_id: `${CHAIN_ID}:${REGISTRY}:${r.tokenId}`,
        owner: clean(r.owner, 42),
        token_uri: clean(r.tokenURI, 400),
        uri_scheme: r.uriScheme,
        registration_resolved: r.resolved ?? false,
        registration_error: clean(r.resolveError, 200),
        name: clean(r.regName, 160),
        protocols: (r.endpoints ?? []).map((e) => e.kind.toUpperCase()),
        x402_supported: r.x402 ?? false,
        supported_trust: (r.supportedTrust ?? []).map((t) => clean(t, 60)).filter(Boolean) as string[] | null,
        self_declared_active: r.regActive ?? null,
        operator_key: firstOp ? `host:${firstOp}` : null,
        trust_state: st.state,
        trust_reason: clean(st.reason, 300),
        category: cls?.category ?? null,
        category_matched: cls?.matched ?? null,
        lint_usable: r.callable ?? false,
        lint_defects: sql.json((r.endpoints ?? []).flatMap((e) =>
          (e.fatal ?? []).map((code) => ({ code, severity: "fatal", detail: `${code} in ${clean(e.url, 120) ?? "(unprintable url)"}` })))),
      };
    });
    await sql`
      insert into agents ${sql(chunk as any)}
      on conflict (chain_id, token_id) do update set
        owner = excluded.owner,
        token_uri = excluded.token_uri,
        uri_scheme = excluded.uri_scheme,
        registration_resolved = excluded.registration_resolved,
        registration_error = excluded.registration_error,
        name = coalesce(excluded.name, agents.name),
        protocols = excluded.protocols,
        x402_supported = excluded.x402_supported,
        supported_trust = excluded.supported_trust,
        self_declared_active = excluded.self_declared_active,
        operator_key = coalesce(excluded.operator_key, agents.operator_key),
        trust_state = case when agents.trust_state = 'VERIFIED' then agents.trust_state else excluded.trust_state end,
        trust_reason = case when agents.trust_state = 'VERIFIED' then agents.trust_reason else excluded.trust_reason end,
        category = coalesce(excluded.category, agents.category),
        lint_usable = excluded.lint_usable,
        lint_defects = excluded.lint_defects,
        updated_at = now()
    `;
    wrote += chunk.length;
    if (wrote % 3000 === 0) console.log(`    agents ${wrote.toLocaleString()}/${rows.length.toLocaleString()}`);
  }
  console.log(`  agents written     ${wrote.toLocaleString()}`);

  // Endpoints: replace wholesale for the tokens we just loaded.
  const eps: any[] = [];
  for (const r of rows) {
    for (const e of r.endpoints ?? []) {
      eps.push({
        chain_id: CHAIN_ID, token_id: r.tokenId,
        kind: clean(e.kind, 12) ?? "web", url: clean(e.url, 500) ?? "", version: clean(e.version, 40),
        host: clean(e.host, 253), probe_tier: (e.fatal?.length ?? 0) > 0 ? 3 : 1,
      });
    }
  }
  await sql`delete from agent_endpoints where chain_id = ${CHAIN_ID}`;
  for (let i = 0; i < eps.length; i += 500) {
    await sql`insert into agent_endpoints ${sql(eps.slice(i, i + 500))}`;
  }
  console.log(`  endpoints written  ${eps.length.toLocaleString()}`);

  await sql`
    update operators o set
      agent_count = c.n, validated_count = c.v, fatal_defect_count = c.f, updated_at = now()
    from (
      select operator_key,
             count(*)::int as n,
             count(*) filter (where trust_state = 'VERIFIED')::int as v,
             count(*) filter (where trust_state = 'SHADOWED')::int as f
      from agents where operator_key is not null group by operator_key
    ) c where o.key = c.operator_key
  `;

  const [tot] = await sql<{ n: number }[]>`select count(*)::int as n from agents`;
  const states = await sql<{ trust_state: string; n: number }[]>`
    select trust_state, count(*)::int as n from agents group by trust_state order by n desc`;
  const cats = await sql<{ category: string | null; n: number }[]>`
    select category, count(*)::int as n from agents group by category order by n desc`;
  const topOps = await sql<{ label: string; agent_count: number; fatal_defect_count: number }[]>`
    select label, agent_count, fatal_defect_count from operators order by agent_count desc limit 8`;
  const [size] = await sql<{ s: string }[]>`select pg_size_pretty(pg_database_size(current_database())) as s`;

  console.log(`\n  AGENTS IN DB       ${tot!.n.toLocaleString()}`);
  console.log(`  trust states       ${states.map((s) => `${s.trust_state}=${s.n}`).join("  ")}`);
  console.log(`  categories         ${cats.map((c) => `${c.category ?? "none"}=${c.n}`).join("  ")}`);
  console.log(`  database size      ${size!.s}`);
  console.log(`\n  top operators:`);
  for (const o of topOps) {
    console.log(`    ${o.label.slice(0, 36).padEnd(37)} ${String(o.agent_count).padStart(6)} agents  ${o.fatal_defect_count} broken`);
  }
  console.log("");
} catch (e: any) {
  console.error(`\n  LOAD FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
  if (e?.detail) console.error(`  detail: ${String(e.detail).slice(0, 200)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 10 });
}
