/**
 * Post-surgery verification: where do writes vs size-reads land, and did the
 * reclaim actually happen? Read-only (plus one tiny probe of routing).
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [c] = await sql<{ n: number }[]>`select count(*)::int as n from probes_raw`;
  const [sz] = await sql<{ db: string; pr: string; a: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as db,
           pg_size_pretty(pg_total_relation_size('public.probes_raw')) as pr,
           pg_size_pretty(pg_total_relation_size('public.agents')) as a`;
  const [recovery] = await sql<{ in_recovery: boolean; replicas: number }[]>`
    select pg_is_in_recovery() as in_recovery,
           (select count(*)::int from pg_stat_replication) as replicas`;
  console.log(`probes_raw live rows: ${c?.n.toLocaleString()}`);
  console.log(`db: ${sz?.db} | probes_raw: ${sz?.pr} | agents: ${sz?.a}`);
  console.log(`this connection in recovery (read replica): ${recovery?.in_recovery} | replication slots/streams: ${recovery?.replicas}`);
  const [lj] = await sql<{ lsn: string }[]>`select pg_last_wal_replay_lsn()::text as lsn`;
  console.log(`replay lsn (null on primary): ${lj?.lsn ?? "(primary)"}`);
} catch (e: any) {
  console.error(`query failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
