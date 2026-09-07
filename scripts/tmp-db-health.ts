/** Quick DB health: table sizes, lock waits, cache pressure. Read-only. */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const r = await sql<any[]>`
    select
      (select count(*)::int from agents) as agents_rows,
      (select pg_size_pretty(pg_total_relation_size('agents')) as x) as agents_size,
      (select n_live_tup from pg_stat_user_tables where relname = 'agents') as agents_live,
      (select pg_size_pretty(pg_database_size(current_database())) as x) as db_size,
      (select count(*)::int from pg_stat_activity where state = 'active' and pid <> pg_backend_pid()) as active_backends,
      (select count(*)::int from pg_locks where not granted) as waiting_locks`;
  console.log(JSON.stringify(r[0], null, 2));
  const idx = await sql<any[]>`
    select indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) as sz
    from pg_stat_user_indexes
    where relname = 'agents' order by idx_scan desc limit 8`;
  for (const i of idx) console.log(`${i.indexrelname}: scans=${i.idx_scan} size=${i.sz}`);
} catch (e: any) {
  console.log(`err: ${e.message}`);
} finally {
  await sql.end({ timeout: 5 });
}
