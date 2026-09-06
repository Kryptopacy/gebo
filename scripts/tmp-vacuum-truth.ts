/**
 * Did ANY vacuum actually run? pg_stat_user_tables records last_vacuum and
 * dead-tuple counts - if the DELETE left 200k dead tuples and last_vacuum is
 * null, the VACUUM FULL "ok" was a lie from the transaction pooler.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const rows = await sql<{
    relname: string; n_live_tup: number; n_dead_tup: number;
    last_vacuum: string | null; last_autovacuum: string | null;
  }[]>`
    select relname, n_live_tup, n_dead_tup,
           last_vacuum::text, last_autovacuum::text
    from pg_stat_user_tables
    where relname in ('probes_raw', 'agents', 'registry_tokens')`;
  for (const r of rows) {
    console.log(`${r.relname}: live=${r.n_live_tup.toLocaleString()} dead=${r.n_dead_tup.toLocaleString()}`);
    console.log(`  last_vacuum=${r.last_vacuum ?? "never"} last_autovacuum=${r.last_autovacuum ?? "never"}`);
  }
} catch (e: any) {
  console.error(`query failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
