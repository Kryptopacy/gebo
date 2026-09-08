/** Apply 0038 (fleet guard + the opportunities bonus job at 30 min), run the guard once. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });

async function main() {
  try {
    await sql.unsafe(readFileSync("supabase/migrations/0038_fleet_guard.sql", "utf8"));
    console.log("0038 applied");

    const [lat] = await sql<{ ms: string }[]>`select public.gebo_db_latency_ms()::text as ms`;
    console.log(`db latency now: ${lat?.ms}ms`);

    const [guard] = await sql<{ r: string }[]>`select public.gebo_fleet_guard() as r`;
    console.log(`guard run: ${guard?.r}`);

    const jobs = await sql<{ jobname: string; schedule: string }[]>`
      select jobname, schedule from cron.job
      where jobname in ('gebo-guard', 'gebo-opportunities')
      order by jobname`;
    for (const j of jobs) console.log(`${j.jobname}: [${j.schedule}]`);
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
