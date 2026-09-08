/**
 * Emergency load shed: the free tier is hard-throttling the database
 * (select 1 = 6s, statement timeouts on both pooler modes, 2026-09-08
 * ~10:30 UTC). The fastest path out of a usage throttle is maximum load
 * reduction. This pauses every cron that is not load-bearing for the
 * product's core claim (verification): sessions/opportunities/classify
 * refreshes, and the aggregate refreshers, leaving ingestion + probing +
 * materialize + maintenance alive.
 *
 * REVERSIBLE: re-running the schedule statements from the named migrations
 * restores each job. tmp-restore-crons.ts does exactly that.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });

const PAUSE = [
  "gebo-sessions",      // 0034 - third-party index, accumulates later
  "gebo-classify",      // backlog drains when restored
  "gebo-opportunities", // rows render with updated_at; staleness disclosed
];

const KEEP = [
  "gebo-resolve", "gebo-materialize", "gebo-sync", "gebo-probe",
  "gebo-probes-rotate", "gebo-maint", "gebo-reputation", "gebo-paper",
  "gebo-regrant-daily", "gebo-counts",
];

async function main() {
  try {
    const jobs = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
      select jobname, schedule, active from cron.job order by jobname`;
    console.log(`current jobs:`);
    for (const j of jobs) console.log(`  ${String(j.jobname).padEnd(20)} [${j.schedule}] active=${j.active}`);

    for (const name of PAUSE) {
      const r = await sql`select cron.unschedule(${name}) as ok`;
      console.log(`unscheduled ${name}: ${r[0]?.ok}`);
    }
    console.log(`\nkept: ${KEEP.join(", ")}`);
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
