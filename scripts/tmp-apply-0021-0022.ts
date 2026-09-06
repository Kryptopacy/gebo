/**
 * Apply migrations 0021 (probes_raw rotation) and 0022 (regrant through
 * Nov 5). Idempotent: cron.schedule replaces same-name jobs, safe to re-run.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

const files = [
  "supabase/migrations/0021_probes_raw_rotation.sql",
  "supabase/migrations/0022_regrant_through_nov5.sql",
];

try {
  for (const f of files) {
    await sql.unsafe(readFileSync(f, "utf8"));
    console.log(`applied ${f}`);
  }
  const jobs = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active from cron.job order by jobname`;
  for (const j of jobs) {
    console.log(`${j.active ? "active" : "INACTIVE"}  ${j.jobname.padEnd(24)} [${j.schedule}]`);
  }
  const need = ["gebo-probes-rotate", "gebo-regrant-late-sep", "gebo-regrant-oct", "gebo-regrant-nov"];
  const missing = need.filter((n) => !jobs.some((j) => j.jobname === n && j.active));
  if (missing.length) {
    console.error(`missing/inactive: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
} catch (e: any) {
  console.error(`migration failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
