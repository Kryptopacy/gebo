/**
 * Apply migration 0018 (regrant_judging_window) through the same connection
 * the cron jobs write through. Idempotent: cron.schedule with an existing
 * jobname replaces the schedule, safe to re-run.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
const path = "supabase/migrations/0018_regrant_judging_window.sql";
const ddl = readFileSync(path, "utf8");

try {
  await sql.unsafe(ddl);
  const jobs = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active from cron.job
    where jobname like 'gebo-regrant%'
    order by jobname
  `;
  for (const j of jobs) {
    console.log(`${j.active ? "active" : "INACTIVE"}  ${j.jobname}  [${j.schedule}]`);
  }
  if (!jobs.some((j) => j.jobname === "gebo-regrant-daily" && j.active)) {
    console.error("gebo-regrant-daily missing or inactive");
    process.exitCode = 1;
  }
} catch (e: any) {
  console.error(`migration failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
