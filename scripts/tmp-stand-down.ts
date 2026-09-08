/**
 * FULL stand-down (2026-09-08 ~11:30 UTC): the free-tier throttle plus the
 * minute-level fleet's own retry pressure (resolve every minute, each pass
 * 30-40s+; census refresh dying at the statement timeout and retrying every
 * pass since 09:09) has the database in a death spiral. Everything
 * minute-level pauses; daily/6h jobs stay (they are rare). Restore with
 * tmp-restore-crons.ts once select 1 AND a real count both return fast.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });

const PAUSE = [
  "gebo-resolve", "gebo-materialize", "gebo-sync", "gebo-probe", "gebo-counts",
];

async function main() {
  try {
    for (const name of PAUSE) {
      const r = await sql`select cron.unschedule(${name}) as ok`;
      console.log(`unscheduled ${name}: ${r[0]?.ok}`);
    }
    const jobs = await sql<{ jobname: string; schedule: string }[]>`
      select jobname, schedule from cron.job order by jobname`;
    console.log(`\nremaining:`);
    for (const j of jobs) console.log(`  ${String(j.jobname).padEnd(20)} [${j.schedule}]`);
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
