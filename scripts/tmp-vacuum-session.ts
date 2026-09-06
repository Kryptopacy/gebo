/**
 * VACUUM FULL must run through the SESSION pooler (port 5432): the
 * transaction pooler (6543) silently drops VACUUM statements while reporting
 * success - last_vacuum stayed "never" after the first surgery attempt, the
 * same failure shape as pg_net's "succeeded means queued". Autovacuum cleaned
 * the dead tuples but cannot return space to the quota; only VACUUM FULL
 * rewrites the files smaller.
 */
import "dotenv/config";
import postgres from "postgres";

const txUrl = process.env.DATABASE_URL!;
const sessionUrl = txUrl.replace(":6543", ":5432");

const sql = postgres(sessionUrl, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 20, onnotice: (n) => { if (n.message) console.log(`  notice: ${n.message.slice(0, 100)}`); } });

try {
  const [before] = await sql<{ size: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log(`session pooler connected. database size before: ${before?.size}`);

  for (const t of ["probes_raw", "agents", "registry_tokens"]) {
    const t0 = Date.now();
    await sql.unsafe(`VACUUM FULL ${t}`);
    console.log(`  VACUUM FULL ${t} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const [after] = await sql<{ size: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as size`;
  const sizes = await sql<{ relname: string; s: string; lv: string | null }[]>`
    select relname, pg_size_pretty(pg_total_relation_size(relid)) as s, last_vacuum::text as lv
    from pg_stat_user_tables where relname in ('probes_raw','agents','registry_tokens')`;
  console.log(`database size after: ${after?.size}`);
  for (const r of sizes) console.log(`  ${r.relname}: ${r.s} (last_vacuum ${r.lv?.slice(0, 19) ?? "never"})`);
} catch (e: any) {
  console.error(`vacuum failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 10 });
}
