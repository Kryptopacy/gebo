/** Apply 0029 (registry_counts table + gebo-counts direct-SQL cron, every 5 min). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync("supabase/migrations/0029_registry_counts.sql", "utf8"));
  const [row] = await sql<{ agents: number; computed_at: string }[]>`
    select agents, computed_at::text from registry_counts where id = 'bsc'`;
  const [job] = await sql<{ schedule: string; active: boolean }[]>`
    select schedule, active from cron.job where jobname = 'gebo-counts'`;
  console.log(`registry_counts seeded: agents=${row?.agents} at ${row?.computed_at}`);
  console.log(`gebo-counts: [${job?.schedule}] active=${job?.active}`);
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
