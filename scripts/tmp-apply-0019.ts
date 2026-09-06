/**
 * Apply migration 0019 (materialize_cron). Idempotent: cron.schedule with an
 * existing jobname replaces the schedule, safe to re-run.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
const path = "supabase/migrations/0019_materialize_cron.sql";
const ddl = readFileSync(path, "utf8");

try {
  await sql.unsafe(ddl);
  const jobs = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active from cron.job
    where jobname = 'gebo-materialize'
  `;
  for (const j of jobs) {
    console.log(`${j.active ? "active" : "INACTIVE"}  ${j.jobname}  [${j.schedule}]`);
  }
  if (!jobs.some((j) => j.active)) {
    console.error("gebo-materialize missing or inactive");
    process.exitCode = 1;
  }
} catch (e: any) {
  console.error(`migration failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
