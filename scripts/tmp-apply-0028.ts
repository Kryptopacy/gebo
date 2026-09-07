/** Apply 0028 (materialize cadence relaxed to every 3 minutes). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync("supabase/migrations/0028_materialize_steady.sql", "utf8"));
  const j = await sql<{ schedule: string; active: boolean }[]>`
    select schedule, active from cron.job where jobname = 'gebo-materialize'`;
  console.log(`gebo-materialize: [${j[0]?.schedule}] active=${j[0]?.active}`);
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
