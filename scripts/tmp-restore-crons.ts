/**
 * Restore the jobs paused by tmp-load-shed.ts (2026-09-08 free-tier
 * throttle). Run this once `select 1` returns to ~200ms and ordinary
 * queries stop hitting statement timeouts. Schedules are idempotent
 * (cron.schedule upserts on jobname).
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });

async function main() {
  try {
    await sql.unsafe(
      `select cron.schedule('gebo-sessions', '4,14,24,34,44,54 * * * *', ` +
      `$$select public.gebo_run_cron('/api/cron/sessions')$$);`,
    );
    await sql.unsafe(
      `select cron.schedule('gebo-classify', '*/10 * * * *', ` +
      `$$select public.gebo_run_cron('/api/cron/classify')$$);`,
    );
    await sql.unsafe(
      `select cron.schedule('gebo-opportunities', '*/10 * * * *', ` +
      `$$select public.gebo_run_cron('/api/cron/opportunities')$$);`,
    );
    const jobs = await sql<{ jobname: string; active: boolean }[]>`
      select jobname, active from cron.job
      where jobname in ('gebo-sessions', 'gebo-classify', 'gebo-opportunities')`;
    for (const j of jobs) console.log(`${j.jobname}: active=${j.active}`);
    console.log(`restored.`);
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
