/**
 * Census → product materialization.
 *
 * The census layer (registry_tokens) is kept current by the sync + resolve
 * crons, but every user-facing surface — search, category pages, agent cards,
 * MCP tools, the prober — reads `agents` and `agent_endpoints`. Until
 * 2026-09-06 those tables were only ever populated by hand-run loaders
 * (load-db.ts, load-census.ts), so they froze at token #269686 while the
 * census ran on to #336715: every agent registered after that — including an
 * entire hackathon mint wave — was censused, resolved, and then invisible.
 * A judge who launched an agent and searched for it found nothing.
 *
 * This module is the missing pipeline step. Selection is newest-first so
 * fresh registrations surface within minutes; the backfill script walks the
 * older backlog with the same code.
 *
 * tokenURI is re-read from chain rather than trusted from registry_tokens:
 * sync stores it capped at 500 chars, which cuts long data: URIs mid-JSON.
 * One multicall re-reads a whole batch in a single RPC, and chain is
 * authoritative anyway.
 */
import {
  makeClient, readRange, resolveRegistration, endpointsFromRegistration, REGISTRY,
  type RegistrationFile,
} from "./registry.ts";
import { lintUrl, type Defect } from "./lint.ts";
import { registrableDomain } from "./operator.ts";
import type postgres from "postgres";

export const CHAIN_ID = 56;
const HOST_GAP_MS = 220;
const MAX_LINT_DEFECTS = 20;
const MAX_TOKEN_URI = 8000;

type Sql = ReturnType<typeof postgres>;

export type Candidate = {
  token_id: string;
  owner: string | null;
  uri_scheme: string;
  token_uri: string | null;
};

export type BuiltAgent = {
  agent: {
    chain_id: number;
    token_id: string;
    registry: string;
    agent_id: string;
    owner: string | null;
    token_uri: string | null;
    uri_scheme: string | null;
    registration_resolved: boolean;
    name: string | null;
    description: string | null;
    x402_supported: boolean;
    supported_trust: string[] | null;
    self_declared_active: boolean | null;
    operator_key: string | null;
    trust_state: string;
    trust_reason: string;
    lint_usable: boolean;
    lint_defects: Defect[] | null;
    registration_json: RegistrationFile;
  };
  endpoints: { chain_id: number; token_id: string; kind: string; url: string; version: string | null; host: string | null }[];
  operator: { key: string; kind: string; registrable_domain: string | null; label: string } | null;
};

function clean(v: unknown, max = 300): string | null {
  if (v == null) return null;
  const s = String(v)
    // eslint-disable-next-line no-control-characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .trim();
  return s.length ? s.slice(0, max) : null;
}

/**
 * Map a resolved registration file to agent + endpoint rows.
 *
 * Trust starts DORMANT and the probe cron promotes within minutes — except
 * when every protocol endpoint carries a fatal lint defect (an
 * unsubstituted template variable, a placeholder domain): those are SHADOWED
 * immediately because no client can ever call them, matching the loader this
 * replaces. Trust is demoted, never fabricated (PRODUCT_SPEC §2).
 */
export function buildAgentFromRegistration(c: Candidate, file: RegistrationFile, tokenUri: string | null): BuiltAgent {
  const endpoints = endpointsFromRegistration(file).map((e) => {
    let host: string | null = null;
    try { host = new URL(e.url).hostname; } catch { /* unparseable URL, lint flags it */ }
    return {
      chain_id: CHAIN_ID,
      token_id: c.token_id,
      kind: e.kind,
      url: e.url,
      version: clean(e.version ?? null, 48),
      host,
    };
  });

  const seen = new Set<string>();
  const lintDefects = endpoints
    .flatMap((e) => lintUrl(e.url))
    .filter((d) => {
      const k = `${d.code}|${d.detail}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_LINT_DEFECTS);

  const protocolEps = endpoints.filter((e) => e.kind === "a2a" || e.kind === "mcp");
  const callable = protocolEps.some((e) => !lintUrl(e.url).some((d) => d.severity === "fatal"));

  let trustState = "DORMANT";
  let trustReason = "not yet probed";
  if (!endpoints.length) {
    trustReason = "declares no endpoint in its registration";
  } else if (protocolEps.length && !callable) {
    trustState = "SHADOWED";
    const fatal = lintUrl(protocolEps[0]!.url).find((d) => d.severity === "fatal");
    trustReason = fatal?.code === "template_var"
      ? "registration contains an unsubstituted template variable — uncallable by any client"
      : (fatal?.detail ?? "no callable endpoint");
  }

  const firstHosted = endpoints.find((e) => e.host);
  const domain = firstHosted?.host ? registrableDomain(firstHosted.host) : null;
  const operator = domain
    ? { key: `host:${domain}`, kind: "host", registrable_domain: domain, label: domain }
    : null;

  const supportedTrust = (file.supportedTrust ?? []).map((t) => clean(t, 48)).filter(Boolean) as string[];

  return {
    agent: {
      chain_id: CHAIN_ID,
      token_id: c.token_id,
      registry: REGISTRY,
      agent_id: `${CHAIN_ID}:${REGISTRY}:${c.token_id}`,
      owner: clean(c.owner, 42),
      token_uri: clean(tokenUri ?? c.token_uri, MAX_TOKEN_URI),
      uri_scheme: clean(c.uri_scheme, 12),
      registration_resolved: true,
      name: clean(file.name, 200),
      description: clean(file.description, 2000),
      x402_supported: file.x402Support === true,
      supported_trust: supportedTrust.length ? supportedTrust : null,
      self_declared_active: file.active === true,
      operator_key: operator?.key ?? null,
      trust_state: trustState,
      trust_reason: trustReason,
      lint_usable: callable,
      lint_defects: lintDefects.length ? lintDefects : null,
      registration_json: file,
    },
    endpoints,
    operator,
  };
}

export type MaterializeSummary = {
  candidates: number;
  materialized: number;
  skippedUnresolvable: number;
  burned: number;
  endpointsAdded: number;
  remaining: number;
  ms: number;
};

const ZERO: Omit<MaterializeSummary, "remaining" | "ms"> = {
  candidates: 0, materialized: 0, skippedUnresolvable: 0, burned: 0, endpointsAdded: 0,
};

/**
 * Materialize one bounded slice of census rows into agents/agent_endpoints.
 * Safe to run repeatedly: candidates are re-selected by absence, endpoint
 * inserts are deduped, agent upserts never overwrite probe-derived trust.
 */
export async function materializeSlice(
  sql: Sql,
  opts: { slice?: number; timeBudgetMs?: number; hostGapMs?: number; order?: "desc" | "asc"; concurrency?: number } = {},
): Promise<MaterializeSummary> {
  const slice = opts.slice ?? 80;
  const timeBudgetMs = opts.timeBudgetMs ?? 45_000;
  const hostGapMs = opts.hostGapMs ?? HOST_GAP_MS;
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const order = opts.order === "asc" ? "asc" : "desc";
  const startedAt = Date.now();

  // Two literal branches rather than a dynamically-built ORDER BY: postgres.js
  // has no sql.raw in this version, and a bound literal cannot drift.
  //
  // Candidates include resolved+named rows with NO stored token_uri: the
  // pre-cron sync script (sync-registry.ts) resolved 188k registrations
  // without persisting the URI, and those rows would otherwise stay invisible
  // forever. Their URI comes from the chain re-read below.
  const where = sql`
    r.resolved = true and r.has_name = true
    and (r.token_uri is not null or r.uri_scheme in ('data', 'https', 'http', 'ipfs'))
    and not exists (
      select 1 from agents a
      where a.chain_id = ${CHAIN_ID} and a.token_id = r.token_id
    )`;
  const candidates = order === "asc"
    ? await sql<Candidate[]>`
        select r.token_id::text as token_id, r.owner, r.uri_scheme, r.token_uri
        from registry_tokens r
        where ${where}
        order by r.token_id asc
        limit ${slice}`
    : await sql<Candidate[]>`
        select r.token_id::text as token_id, r.owner, r.uri_scheme, r.token_uri
        from registry_tokens r
        where ${where}
        order by r.token_id desc
        limit ${slice}`;

  if (!candidates.length) {
    return { ...ZERO, remaining: 0, ms: Date.now() - startedAt };
  }

  // Re-read owner + full tokenURI from chain: one multicall for the batch.
  // If chain is unreachable, fall back to the stored (possibly truncated)
  // URI — short registrations still resolve, and the next run retries the rest.
  let chainRows: Awaited<ReturnType<typeof readRange>> | null = null;
  try {
    const client = makeClient();
    chainRows = await readRange(client, candidates.map((c) => BigInt(c.token_id)));
  } catch {
    chainRows = null;
  }
  const byId = new Map((chainRows ?? []).map((r) => [r.tokenId, r]));

  // Heal token_uri in the census itself: the pre-cron sync script resolved
  // 188k registrations without storing the URI, and a census that cannot say
  // where an agent's registration lives forces every consumer back to chain.
  // Only NULL uris are healed — rows that already carry a (possibly
  // truncated) URI are owned by the sync cron, and touching them here only
  // adds lock contention on the pooler.
  if (chainRows?.length) {
    const withUri = chainRows.filter((r) => r.tokenURI);
    if (withUri.length) {
      const ids = withUri.map((r) => r.tokenId);
      const uris = withUri.map((r) => r.tokenURI!.slice(0, 500));
      await sql`
        update registry_tokens r set
          token_uri = v.uri,
          checked_at = now()
        from unnest(${sql.array(ids)}::bigint[], ${sql.array(uris)}::text[]) as v(token_id, uri)
        where r.token_id = v.token_id and r.token_uri is null and v.uri is not null`;
    }
  }

  const hostNext = new Map<string, number>();
  const built: BuiltAgent[] = [];
  let skipped = 0;
  let burned = 0;
  let cursor = 0;

  // Workers share the host-pacing map, so remote fetches stay polite per host
  // while independent hosts resolve in parallel (the resolve cron's pattern).
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= candidates.length) return;
      if (Date.now() - startedAt > timeBudgetMs) return;

      const c = candidates[i]!;
      const chainRow = byId.get(c.token_id);
      // owner null from a successful chain read = token burned since census.
      if (chainRows && chainRow && !chainRow.owner) { burned++; continue; }
      const uri = chainRow?.tokenURI ?? c.token_uri;
      if (!uri) { skipped++; continue; }

      const isRemote = !uri.trim().toLowerCase().startsWith("data:");
      if (isRemote) {
        let host: string | null = null;
        try { host = new URL(uri).hostname; } catch { /* lint will flag it */ }
        if (host) {
          const now = Date.now();
          const next = Math.max(hostNext.get(host) ?? 0, now);
          hostNext.set(host, next + hostGapMs);
          if (next > now) await new Promise((r) => setTimeout(r, next - now));
        }
      }

      const res = await resolveRegistration(uri, 8000);
      if (!res.ok) { skipped++; continue; }
      built.push(buildAgentFromRegistration(c, res.file, uri));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // Operators must be upserted BEFORE the agents that reference them:
  // agents.operator_key has a foreign key to operators.key, and a new
  // operator's first agent otherwise aborts the whole agents insert.
  const opRows = [...new Map(built.map((b) => b.operator).filter(Boolean).map((o) => [o!.key, o!])).values()];
  if (opRows.length) {
    await sql`
      insert into operators ${sql(opRows)}
      on conflict (key) do update set
        kind = excluded.kind,
        registrable_domain = excluded.registrable_domain,
        label = excluded.label,
        updated_at = now()`;
  }

  if (built.length) {
    for (let i = 0; i < built.length; i += 200) {
      // `as any`: RegistrationFile carries unknown[] fields (skills, domains)
      // that postgres.js's JSONValue type cannot express, but they serialize.
      const chunk = built.slice(i, i + 200).map((b) => ({
        ...b.agent,
        registration_json: sql.json(b.agent.registration_json as any),
        lint_defects: sql.json(b.agent.lint_defects ?? []),
      }));
      await sql`
        insert into agents ${sql(chunk)}
        on conflict (chain_id, token_id) do update set
          owner = coalesce(excluded.owner, agents.owner),
          token_uri = coalesce(excluded.token_uri, agents.token_uri),
          uri_scheme = excluded.uri_scheme,
          registration_resolved = excluded.registration_resolved,
          name = coalesce(excluded.name, agents.name),
          description = coalesce(excluded.description, agents.description),
          x402_supported = excluded.x402_supported,
          supported_trust = excluded.supported_trust,
          self_declared_active = excluded.self_declared_active,
          operator_key = coalesce(excluded.operator_key, agents.operator_key),
          lint_usable = excluded.lint_usable,
          lint_defects = excluded.lint_defects,
          updated_at = now()`;
    }
  }

  // Endpoints: skip (chain_id, token_id, url) pairs that already exist so a
  // re-run never stacks duplicates — the table has no unique constraint.
  let endpointsAdded = 0;
  const eps = built.flatMap((b) => b.endpoints);
  if (eps.length) {
    const ids = [...new Set(built.map((b) => b.agent.token_id))];
    const existing = await sql<{ token_id: string; url: string }[]>`
      select token_id::text as token_id, url
      from agent_endpoints
      where chain_id = ${CHAIN_ID} and token_id = any(${ids})`;
    const have = new Set(existing.map((e) => `${e.token_id}|${e.url}`));
    const fresh = eps.filter((e) => !have.has(`${e.token_id}|${e.url}`));
    if (fresh.length) {
      for (let i = 0; i < fresh.length; i += 200) {
        await sql`insert into agent_endpoints ${sql(fresh.slice(i, i + 200))}`;
      }
      endpointsAdded = fresh.length;
    }
  }

  // Operator counters are recounted after the agents exist (loader parity).
  if (opRows.length) {
    const keys = opRows.map((o) => o.key);
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
        from agents
        where operator_key = any(${keys})
        group by operator_key
      ) c
      where o.key = c.operator_key`;
  }

  const [rem] = await sql<{ n: number }[]>`
    select count(*)::int as n
    from registry_tokens r
    where r.resolved = true and r.has_name = true
      and (r.token_uri is not null or r.uri_scheme in ('data', 'https', 'http', 'ipfs'))
      and not exists (
        select 1 from agents a
        where a.chain_id = ${CHAIN_ID} and a.token_id = r.token_id
      )`;

  return {
    candidates: candidates.length,
    materialized: built.length,
    skippedUnresolvable: skipped,
    burned,
    endpointsAdded,
    remaining: rem?.n ?? 0,
    ms: Date.now() - startedAt,
  };
}
