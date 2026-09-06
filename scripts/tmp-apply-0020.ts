/**
 * Apply migration 0020 (materialize every minute). Idempotent: cron.schedule
 * with an existing jobname replaces the schedule, safe to re-run.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
const path = "supabase/migrations/0020_materialize_every_minute.sql";
const ddl = readFileSync(path, "utf8");

try {
  await sql.unsafe(ddl);
  const jobs = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active from cron.job where jobname = 'gebo-materialize'`;
  for (const j of jobs) {
    console.log(`${j.active ? "active" : "INACTIVE"}  ${j.jobname}  [${j.schedule}]`);
  }
  if (!jobs.some((j) => j.active && j.schedule === "* * * * *")) {
    console.error("gebo-materialize not rescheduled to every minute");
    process.exitCode = 1;
  }
} catch (e: any) {
  console.error(`migration failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
