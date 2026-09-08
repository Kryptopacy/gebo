/** Apply 0035 (tick snapshots + retention) and 0036 (paper mode + cron). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync("supabase/migrations/0035_opportunity_fields.sql", "utf8"));
  console.log("0035 applied: pool_tick_snapshots + gebo_maintain retention");
  await sql.unsafe(readFileSync("supabase/migrations/0036_paper_mode.sql", "utf8"));
  console.log("0036 applied: paper_runs + paper_decisions + gebo-paper cron");
  const jobs = await sql<{ jobname: string; schedule: string }[]>`
    select jobname, schedule from cron.job where jobname in ('gebo-paper', 'gebo-sessions', 'gebo-maint', 'gebo-counts') order by jobname`;
  for (const j of jobs) console.log(`  ${j.jobname.padEnd(16)} [${j.schedule}]`);
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
