/**
 * Ops data for the admin dashboard. One loader per panel; each either returns
 * its data or { unavailable: true, reason } - a failed panel must never render
 * as zero (invariant 9), and independent reads run allSettled so one bad
 * query cannot blank the page (invariant 10, the /live lesson).
 */
import postgres from "postgres";
import { RULES_FINGERPRINT } from "./classify.ts";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
}

export type Panel<T> = { data: T | null; unavailable: boolean; reason: string | null };

function ok<T>(data: T): Panel<T> {
  return { data, unavailable: false, reason: null };
}

function down(e: unknown): Panel<never> {
  return { data: null, unavailable: true, reason: String((e as any)?.message ?? e).slice(0, 140) };
}

async function panel<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<Panel<T>> {
  const sql = db();
  if (!sql) return down("DATABASE_URL not set");
  try {
    const data = await fn(sql);
    return ok(data);
  } catch (e) {
    return down(e);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

// ── pipeline ────────────────────────────────────────────────────────────────

export type Pipeline = {
  censusMax: number;
  agentsMax: number;
  lag: number;
  backlog: number;
  materializedLast15m: number;
  fatRowsLast15m: number;
  unresolvedRemote: number;
  endpoints: number;
  callable: number;
};

export function loadPipeline(): Promise<Panel<Pipeline>> {
  return panel(async (sql) => {
    const rows = await sql<any[]>`
      select
        (select max(token_id) from registry_tokens) as census_max,
        (select max(token_id) from agents where chain_id = 56) as agents_max,
        (select count(*) from registry_tokens r
          where r.resolved = true and r.has_name = true
            and (r.token_uri is not null or r.uri_scheme in ('data','https','http','ipfs'))
            and not exists (select 1 from agents a where a.chain_id = 56 and a.token_id = r.token_id)) as backlog,
        (select count(*) from agents where chain_id = 56 and first_seen_at > now() - interval '15 minutes') as last15,
        (select count(*) from agents where chain_id = 56 and first_seen_at > now() - interval '15 minutes' and registration_json is not null) as fat15,
        (select count(*) from registry_tokens
          where resolved = false and uri_scheme in ('https','http','ipfs')
            and token_uri is not null and resolve_attempts < 3) as unresolved_remote,
        (select count(*) from agent_endpoints where chain_id = 56) as endpoints,
        (select count(*) from agents where chain_id = 56 and lint_usable = true) as callable`;
    const r = rows[0] ?? {};
    const censusMax = Number(r.census_max ?? 0);
    const agentsMax = Number(r.agents_max ?? 0);
    return {
      censusMax,
      agentsMax,
      lag: censusMax - agentsMax,
      backlog: Number(r.backlog ?? 0),
      materializedLast15m: Number(r.last15 ?? 0),
      fatRowsLast15m: Number(r.fat15 ?? 0),
      unresolvedRemote: Number(r.unresolved_remote ?? 0),
      endpoints: Number(r.endpoints ?? 0),
      callable: Number(r.callable ?? 0),
    };
  });
}

// ── crons ───────────────────────────────────────────────────────────────────

export type CronPanel = {
  jobs: { jobname: string; schedule: string; active: boolean }[];
  recentRuns: { jobname: string; status: string; end: string }[];
  pgNet: { code: number; n: number }[];
};

export function loadCrons(): Promise<Panel<CronPanel>> {
  return panel(async (sql) => {
    const jobs = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
      select jobname, schedule, active from cron.job order by jobname`;
    const recentRuns = await sql<{ jobname: string; status: string; end: string }[]>`
      select j.jobname, d.status, d.end_time::text as end
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where d.end_time > now() - interval '2 hours'
      order by d.end_time desc limit 14`;
    const net = await sql<{ status_code: number; n: number }[]>`
      select status_code, count(*)::int as n
      from net._http_response
      where created > now() - interval '1 hour'
      group by status_code order by n desc limit 6`;
    return {
      jobs,
      recentRuns: recentRuns.map((r) => ({ jobname: r.jobname, status: r.status, end: r.end })),
      pgNet: net.map((n) => ({ code: n.status_code, n: n.n })),
    };
  });
}

// ── database ────────────────────────────────────────────────────────────────

export type DbPanel = {
  sizeBytes: number;
  topTables: { name: string; rows: number; sizeBytes: number }[];
};

export function loadDb(): Promise<Panel<DbPanel>> {
  return panel(async (sql) => {
    const [size] = await sql<{ n: string | number }[]>`
      select pg_database_size(current_database()) as n`;
    const tables = await sql<{ relname: string; rows: number; size: string | number }[]>`
      select relname, n_live_tup as rows, pg_total_relation_size(relid) as size
      from pg_stat_user_tables
      order by pg_total_relation_size(relid) desc limit 8`;
    return {
      sizeBytes: Number(size?.n ?? 0),
      topTables: tables.map((t) => ({ name: t.relname, rows: Number(t.rows), sizeBytes: Number(t.size) })),
    };
  });
}

// ── funnel + classification + trust ─────────────────────────────────────────

export type Funnel = {
  tokensMinted: number; censused: number; resolved: number; named: number;
  claimActive: number; withEndpoint: number; callable: number;
  agents: number;
};

export function loadFunnel(): Promise<Panel<Funnel>> {
  return panel(async (sql) => {
    const [c] = await sql<any[]>`select * from census_stats where id = 'bsc'`;
    const [a] = await sql<{ n: number }[]>`
      select count(*)::int as n from agents where chain_id = 56`;
    return {
      tokensMinted: Number(c?.tokens_minted ?? 0),
      censused: Number(c?.censused ?? 0),
      resolved: Number(c?.resolved ?? 0),
      named: Number(c?.named ?? 0),
      claimActive: Number(c?.claim_active ?? 0),
      withEndpoint: Number(c?.with_endpoint ?? 0),
      callable: Number(c?.callable ?? 0),
      agents: Number(a?.n ?? 0),
    };
  });
}

export type Classification = {
  rulesFingerprint: string;
  applied: number;
  queued: number;
  judged: number;
  trustStates: { state: string; n: number }[];
};

export function loadClassification(): Promise<Panel<Classification>> {
  return panel(async (sql) => {
    const [applied] = await sql<{ n: number }[]>`
      select count(*)::int as n from agents
      where chain_id = 56 and classify_rules = ${RULES_FINGERPRINT}`;
    const [queued] = await sql<{ n: number }[]>`
      select count(*)::int as n from agents
      where chain_id = 56
        and (name is not null or description is not null or skills is not null)
        and (classify_rules is distinct from ${RULES_FINGERPRINT}
             or (card_fetched_at is not null and card_fetched_at > coalesce(classified_at, 'epoch'::timestamptz)))`;
    const [judged] = await sql<{ n: number }[]>`
      select count(*)::int as n from agents
      where chain_id = 56 and category in ('rebalancing','grid','yield','health')`;
    const states = await sql<{ trust_state: string; n: number }[]>`
      select trust_state, count(*)::int as n from agents
      where chain_id = 56 group by trust_state order by n desc`;
    return {
      rulesFingerprint: RULES_FINGERPRINT,
      applied: applied?.n ?? 0,
      queued: queued?.n ?? 0,
      judged: judged?.n ?? 0,
      trustStates: states,
    };
  });
}

export async function loadAdminData() {
  const [pipeline, crons, database, funnel, classification] = await Promise.allSettled([
    loadPipeline(),
    loadCrons(),
    loadDb(),
    loadFunnel(),
    loadClassification(),
  ]);
  const unwrap = <T>(p: PromiseSettledResult<Panel<T>>): Panel<T> =>
    p.status === "fulfilled" ? p.value : down(p.reason);
  return {
    pipeline: unwrap(pipeline),
    crons: unwrap(crons),
    database: unwrap(database),
    funnel: unwrap(funnel),
    classification: unwrap(classification),
  };
}
