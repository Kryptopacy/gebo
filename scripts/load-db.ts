/**
 * Load the NDJSON produced by scripts/ into Supabase.
 *
 * Two sources, deliberately merged rather than kept separate:
 *
 *   data/census-bsc.ndjson    8004scan detail + graded protocol probes.
 *                             Richest per-agent data, but only ~100 rows
 *                             because the API key is capped at the anonymous
 *                             tier (10 req/min, 100/day).
 *
 *   data/registry-bsc.ndjson  Direct chain reads: owner, tokenURI, URI scheme,
 *                             and resolved registration files. Free and
 *                             unlimited, so this is the path to full coverage.
 *
 * Chain data wins on ownership and tokenURI (it is authoritative); probe data
 * wins on liveness (only we measure it). Upserts throughout, so re-running
 * after a longer census is safe.
 */
import "dotenv/config";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CHAIN_ID = 56;
const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }

const sql = postgres(url, {
  prepare: false,
  max: 3,
  connect_timeout: 25,
  onnotice: (n) => { if (n.severity !== "NOTICE") console.warn(`  [${n.severity}] ${n.message}`); },
});

function readNdjson<T>(file: string): T[] {
  const p = path.join(process.cwd(), "data", file);
  if (!existsSync(p)) return [];
  const out: T[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* partial trailing line */ }
  }
  return out;
}

type CensusRow = {
  token_id: string; agent_id: string; name: string | null; owner_address: string;
  protocols: string[]; x402: boolean; created_at: string;
  operator: { key: string; kind: string; host: string | null; registrableDomain: string | null; owner: string | null };
  endpoints: { kind: string; url: string }[];
  lint: { defects: { code: string; severity: string; detail: string }[]; usable: boolean };
  probe: { kind: string; url: string; grade: string; httpStatus: number | null; rttMs: number; errClass: string; errDetail: string | null; evidence: unknown } | null;
  scan: { health_score: number | null; is_active: boolean | null; endpoint_verified: boolean | null; total_score: number; total_feedbacks: number };
  probed_at: string;
};

type RegistryRow = {
  tokenId: string; owner: string | null; tokenURI: string | null; uriScheme: string;
  resolved?: boolean; resolveError?: string | null; regName?: string | null;
  regActive?: boolean | null; x402?: boolean | null; supportedTrust?: string[] | null;
  endpoints?: { kind: string; url: string; version?: string; host: string | null; operator: string | null; fatal: string[] }[];
  callable?: boolean; readAt: string;
};

const census = readNdjson<CensusRow>("census-bsc.ndjson");
const registry = readNdjson<RegistryRow>("registry-bsc.ndjson");

console.log(`\n  census rows   ${census.length}`);
console.log(`  registry rows ${registry.length}\n`);

// ── keyword classifier, mirrors src/lib/data.ts ─────────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  rebalancing: ["rebalanc", "liquidity", "lp ", "concentrated", "range", "pancake", "uniswap", "pool", "position manager"],
  grid: ["grid", "dca", "market mak", "spread", "band", "range trad", "scalp", "arbitrage"],
  yield: ["yield", "apy", "apr", "farm", "vault", "stake", "staking", "optimi", "compound", "lend", "venus", "aave", "lista"],
  health: ["health factor", "liquidat", "collateral", "ltv", "borrow", "debt", "margin call", "loan", "monitor"],
};

function classify(text: string): { category: string | null; matched: string[] } {
  const hay = text.toLowerCase();
  let best: { category: string; matched: string[] } | null = null;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    const matched = kws.filter((k) => hay.includes(k));
    if (matched.length && (!best || matched.length > best.matched.length)) best = { category: cat, matched };
  }
  return best ?? { category: null, matched: [] };
}

function trustState(row: CensusRow): { state: string; reason: string } {
  const fatal = row.lint?.defects?.filter((d) => d.severity === "fatal") ?? [];
  if (fatal.length) {
    return {
      state: "SHADOWED",
      reason: fatal[0]!.code === "template_var"
        ? "registration contains an unsubstituted template variable — uncallable by any client"
        : fatal[0]!.detail,
    };
  }
  if (row.probe?.grade === "validated") return { state: "VERIFIED", reason: "completed a protocol handshake" };
  if (row.probe?.grade === "responded") return { state: "LISTED", reason: "server responded but did not speak the protocol" };
  return { state: "DORMANT", reason: row.probe?.errDetail ?? "no response" };
}

try {
  // ── operators ───────────────────────────────────────────────────────────
  const ops = new Map<string, { key: string; kind: string; domain: string | null; label: string }>();
  for (const r of census) {
    if (!r.operator?.key) continue;
    ops.set(r.operator.key, {
      key: r.operator.key,
      kind: r.operator.kind,
      domain: r.operator.registrableDomain,
      label: r.operator.registrableDomain ?? r.operator.owner ?? "unknown",
    });
  }
  for (const r of registry) {
    for (const e of r.endpoints ?? []) {
      if (!e.operator) continue;
      const key = `host:${e.operator}`;
      if (!ops.has(key)) ops.set(key, { key, kind: "host", domain: e.operator, label: e.operator });
    }
  }

  if (ops.size) {
    await sql`
      insert into operators ${sql([...ops.values()].map((o) => ({
        key: o.key, kind: o.kind, registrable_domain: o.domain, label: o.label,
      })))}
      on conflict (key) do update set
        kind = excluded.kind,
        registrable_domain = excluded.registrable_domain,
        label = excluded.label,
        updated_at = now()
    `;
  }
  console.log(`  operators upserted        ${ops.size}`);

  // ── agents: chain rows first (authoritative on owner/tokenURI) ─────────
  if (registry.length) {
    for (let i = 0; i < registry.length; i += 400) {
      const chunk = registry.slice(i, i + 400).map((r) => {
        const cls = classify(`${r.regName ?? ""}`);
        return {
          chain_id: CHAIN_ID,
          token_id: r.tokenId,
          registry: REGISTRY,
          agent_id: `${CHAIN_ID}:${REGISTRY}:${r.tokenId}`,
          owner: r.owner,
          token_uri: r.tokenURI,
          uri_scheme: r.uriScheme,
          registration_resolved: r.resolved ?? false,
          registration_error: r.resolveError ?? null,
          name: r.regName ?? null,
          x402_supported: r.x402 ?? false,
          supported_trust: r.supportedTrust ?? null,
          self_declared_active: r.regActive ?? null,
          operator_key: r.endpoints?.[0]?.operator ? `host:${r.endpoints[0].operator}` : null,
          category: cls.category,
          category_matched: cls.matched.length ? cls.matched : null,
          lint_usable: r.callable ?? false,
        };
      });
      await sql`
        insert into agents ${sql(chunk)}
        on conflict (chain_id, token_id) do update set
          owner = excluded.owner,
          token_uri = excluded.token_uri,
          uri_scheme = excluded.uri_scheme,
          registration_resolved = excluded.registration_resolved,
          registration_error = excluded.registration_error,
          name = coalesce(excluded.name, agents.name),
          x402_supported = excluded.x402_supported,
          supported_trust = excluded.supported_trust,
          self_declared_active = excluded.self_declared_active,
          operator_key = coalesce(excluded.operator_key, agents.operator_key),
          updated_at = now()
      `;
    }
  }
  console.log(`  agents from chain         ${registry.length}`);

  // ── agents: census rows carry liveness and lint ────────────────────────
  if (census.length) {
    const chunk = census.map((r) => {
      const st = trustState(r);
      const cls = classify(`${r.name ?? ""} ${r.protocols.join(" ")}`);
      return {
        chain_id: CHAIN_ID,
        token_id: r.token_id,
        registry: REGISTRY,
        agent_id: r.agent_id,
        owner: r.owner_address,
        name: r.name,
        protocols: r.protocols?.length ? r.protocols : null,
        x402_supported: r.x402,
        operator_key: r.operator?.key ?? null,
        trust_state: st.state,
        trust_reason: st.reason,
        category: cls.category,
        category_matched: cls.matched.length ? cls.matched : null,
        lint_usable: r.lint?.usable ?? false,
        lint_defects: sql.json(r.lint?.defects ?? []),
        registered_at: r.created_at,
      };
    });
    await sql`
      insert into agents ${sql(chunk)}
      on conflict (chain_id, token_id) do update set
        name = coalesce(excluded.name, agents.name),
        protocols = excluded.protocols,
        x402_supported = excluded.x402_supported,
        operator_key = coalesce(excluded.operator_key, agents.operator_key),
        trust_state = excluded.trust_state,
        trust_reason = excluded.trust_reason,
        category = coalesce(excluded.category, agents.category),
        category_matched = coalesce(excluded.category_matched, agents.category_matched),
        lint_usable = excluded.lint_usable,
        lint_defects = excluded.lint_defects,
        registered_at = coalesce(excluded.registered_at, agents.registered_at),
        updated_at = now()
    `;
  }
  console.log(`  agents enriched w/ probes ${census.length}`);

  // ── endpoints ───────────────────────────────────────────────────────────
  await sql`delete from agent_endpoints where chain_id = ${CHAIN_ID}`;
  const eps: any[] = [];
  for (const r of census) {
    for (const e of r.endpoints ?? []) {
      let host: string | null = null;
      try { host = new URL(e.url).hostname; } catch { /* unparseable */ }
      eps.push({
        chain_id: CHAIN_ID, token_id: r.token_id, kind: e.kind, url: e.url,
        host, probe_tier: r.probe?.grade === "validated" ? 0 : 2,
      });
    }
  }
  for (const r of registry) {
    for (const e of r.endpoints ?? []) {
      eps.push({
        chain_id: CHAIN_ID, token_id: r.tokenId, kind: e.kind, url: e.url,
        version: e.version ?? null, host: e.host, probe_tier: 1,
      });
    }
  }
  if (eps.length) {
    for (let i = 0; i < eps.length; i += 500) {
      await sql`insert into agent_endpoints ${sql(eps.slice(i, i + 500))}`;
    }
  }
  console.log(`  endpoints inserted        ${eps.length}`);

  // ── probes ──────────────────────────────────────────────────────────────
  const probed = census.filter((r) => r.probe);
  if (probed.length) {
    const ids = await sql<{ id: number; token_id: string; url: string }[]>`
      select id, token_id::text as token_id, url from agent_endpoints where chain_id = ${CHAIN_ID}
    `;
    const byKey = new Map(ids.map((x) => [`${x.token_id}|${x.url}`, x.id]));

    const raw: any[] = [];
    const daily = new Map<number, any>();
    for (const r of probed) {
      const id = byKey.get(`${r.token_id}|${r.probe!.url}`);
      if (!id) continue;
      raw.push({
        endpoint_id: id, at: r.probed_at, grade: r.probe!.grade,
        http_status: r.probe!.httpStatus, rtt_ms: r.probe!.rttMs,
        err_class: r.probe!.errClass,
        evidence: r.probe!.evidence ? sql.json(r.probe!.evidence as any) : null,
      });
      const day = r.probed_at.slice(0, 10);
      const ok = r.probe!.grade !== "failed";
      daily.set(id, {
        endpoint_id: id, day,
        probes: 1, ok_count: ok ? 1 : 0,
        validated_count: r.probe!.grade === "validated" ? 1 : 0,
        p50_ms: r.probe!.rttMs, p95_ms: r.probe!.rttMs,
        fail_streak: ok ? 0 : 1,
        last_ok_at: ok ? r.probed_at : null,
        err_counts: sql.json({ [r.probe!.errClass]: 1 }),
      });
    }
    if (raw.length) {
      for (let i = 0; i < raw.length; i += 500) {
        await sql`insert into probes_raw ${sql(raw.slice(i, i + 500))}`;
      }
    }
    if (daily.size) {
      await sql`
        insert into probe_daily ${sql([...daily.values()])}
        on conflict (endpoint_id, day) do update set
          probes = probe_daily.probes + excluded.probes,
          ok_count = probe_daily.ok_count + excluded.ok_count,
          validated_count = probe_daily.validated_count + excluded.validated_count,
          p50_ms = excluded.p50_ms,
          p95_ms = excluded.p95_ms,
          fail_streak = excluded.fail_streak,
          last_ok_at = coalesce(excluded.last_ok_at, probe_daily.last_ok_at)
      `;
    }
    console.log(`  probes_raw inserted       ${raw.length}`);
    console.log(`  probe_daily rollups       ${daily.size}`);
  }

  // ── operator counters ───────────────────────────────────────────────────
  await sql`
    update operators o set
      agent_count = c.n,
      validated_count = c.v,
      fatal_defect_count = c.f,
      updated_at = now()
    from (
      select operator_key,
             count(*)::int as n,
             count(*) filter (where trust_state = 'VERIFIED')::int as v,
             count(*) filter (where trust_state = 'SHADOWED')::int as f
      from agents where operator_key is not null group by operator_key
    ) c
    where o.key = c.operator_key
  `;

  // ── summary ─────────────────────────────────────────────────────────────
  const [tot] = await sql<{ n: number }[]>`select count(*)::int as n from agents`;
  const states = await sql<{ trust_state: string; n: number }[]>`
    select trust_state, count(*)::int as n from agents group by trust_state order by n desc
  `;
  const schemes = await sql<{ uri_scheme: string | null; n: number }[]>`
    select uri_scheme, count(*)::int as n from agents group by uri_scheme order by n desc
  `;
  const topOps = await sql<{ label: string; agent_count: number; validated_count: number }[]>`
    select label, agent_count, validated_count from operators order by agent_count desc limit 5
  `;

  console.log(`\n  AGENTS IN DB: ${tot!.n}`);
  console.log(`  trust states: ${states.map((s) => `${s.trust_state}=${s.n}`).join("  ")}`);
  console.log(`  uri schemes:  ${schemes.map((s) => `${s.uri_scheme ?? "null"}=${s.n}`).join("  ")}`);
  console.log(`  top operators:`);
  for (const o of topOps) console.log(`    ${o.label.padEnd(34)} ${o.agent_count} agents, ${o.validated_count} validated`);
  console.log("");
} catch (e: any) {
  console.error(`\n  LOAD FAILED: ${String(e?.message ?? e).slice(0, 400)}`);
  if (e?.detail) console.error(`  detail: ${String(e.detail).slice(0, 200)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 8 });
}
