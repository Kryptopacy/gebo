/**
 * Full fleet restore: everything paused by tmp-load-shed.ts (sessions,
 * classify, opportunities) AND tmp-stand-down.ts (resolve, materialize,
 * sync, probe, counts). Run once the free-tier throttle has drained:
 * `select 1` ~200ms AND a real count query returns in normal time.
 *
 * Schedules are idempotent (cron.schedule upserts on jobname). Cadences
 * are the post-0037 values - the throttling values, not the originals.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });

const SCHEDULES: [string, string, string | null][] = [
  ["gebo-resolve", "* * * * *", "/api/cron/resolve"],
  ["gebo-materialize", "*/3 * * * *", "/api/cron/materialize"],
  ["gebo-sync", "*/5 * * * *", "/api/cron/sync"],
  ["gebo-probe", "*/5 * * * *", "/api/cron/probe"],
  ["gebo-counts", "*/15 * * * *", null], // direct SQL, 0037
  ["gebo-classify", "*/10 * * * *", "/api/cron/classify"],
  ["gebo-opportunities", "*/10 * * * *", "/api/cron/opportunities"],
  ["gebo-sessions", "4,14,24,34,44,54 * * * *", "/api/cron/sessions"],
];

async function main() {
  try {
    for (const [name, schedule, route] of SCHEDULES) {
      const cmd = route
        ? `select cron.schedule('${name}', '${schedule}', $$select public.gebo_run_cron('${route}')$$);`
        : `select cron.schedule('${name}', '${schedule}', $$select public.refresh_registry_counts()$$);`;
      await sql.unsafe(cmd);
      console.log(`scheduled ${name} [${schedule}]`);
    }
    const jobs = await sql<{ jobname: string; active: boolean }[]>`
      select jobname, active from cron.job order by jobname`;
    console.log(`\nactive jobs: ${jobs.filter((j) => j.active).length}`);
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
