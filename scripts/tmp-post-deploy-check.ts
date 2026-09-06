/**
 * Post-deploy verification: the materialize route must now write slim rows
 * (no registration_json), the cron must return 200s, and the database must
 * hold steady while the backlog drains. Read-only.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [fresh] = await sql<{ n: number; fat: number }[]>`
    select count(*)::int as n,
      count(*) filter (where registration_json is not null)::int as fat
    from agents
    where chain_id = 56 and first_seen_at > now() - interval '3 minutes'`;
  console.log(`agents materialized in last 3 min: ${fresh?.n.toLocaleString()} | carrying registration_json: ${fresh?.fat}`);

  const [db] = await sql<{ size: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as size`;
  const [prog] = await sql<{ remaining: number; agents: number }[]>`
    select
      (select count(*)::int from registry_tokens r
        where r.resolved = true and r.has_name = true
          and (r.token_uri is not null or r.uri_scheme in ('data','https','http','ipfs'))
          and not exists (select 1 from agents a where a.chain_id = 56 and a.token_id = r.token_id)) as remaining,
      (select count(*)::int from agents where chain_id = 56) as agents`;
  console.log(`database: ${db?.size} | agents: ${prog?.agents.toLocaleString()} | backlog: ${prog?.remaining.toLocaleString()}`);

  const codes = await sql<{ status_code: number; n: number }[]>`
    select status_code, count(*)::int as n from net._http_response
    where created > now() - interval '15 minutes' group by status_code order by status_code`;
  console.log(`pg_net codes (15 min): ${codes.map((c) => `${c.status_code}=${c.n}`).join(", ") || "(none yet)"}`);
} catch (e: any) {
  console.error(`query failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
