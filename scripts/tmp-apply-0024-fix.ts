/** Apply the corrected 0024 refresh_census_stats (27 columns = 27 expressions). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync("supabase/migrations/0024_stats_refresh_selfguard.sql", "utf8"));
  console.log("0024 re-applied: function recreated with matching column/expression counts");
  // Prove it parses AND runs: force one refresh now (staleness guard returns
  // immediately if within 10 min, so check updated_at instead of assuming).
  await sql.unsafe("select public.refresh_census_stats()");
  const [cs] = await sql<{ updated_at: string }[]>`
    select updated_at::text from census_stats where id = 'bsc'`;
  console.log(`census_stats.updated_at = ${cs?.updated_at}`);
  const [ss] = await sql.unsafe(`
    select calls, mean_exec_time from pg_stat_statements
    where query ilike '%refresh_census_stats%' limit 1
  `).catch(() => [] as any[]);
  if (ss) console.log(`refresh calls=${ss.calls} mean=${Math.round(ss.mean_exec_time)}ms`);
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
