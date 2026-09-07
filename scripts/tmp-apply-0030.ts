/** Apply 0030 (gebo-reputation cron, every 6h, calls /api/cron/reputation). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync("supabase/migrations/0030_reputation_cron.sql", "utf8"));
  const [job] = await sql<{ schedule: string; active: boolean }[]>`
    select schedule, active from cron.job where jobname = 'gebo-reputation'`;
  console.log(`gebo-reputation: [${job?.schedule}] active=${job?.active}`);
  console.log(`NOTE: the route must be deployed before the next 6h UTC boundary or pg_net records 404s.`);
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
