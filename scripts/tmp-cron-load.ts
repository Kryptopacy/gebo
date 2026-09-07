/** Which cron jobs are over-running their schedule? Read-only. */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const runs = await sql<{ jobname: string; runs: number; avg_ms: number; max_ms: number }[]>`
    select j.jobname, count(*)::int as runs,
           avg(extract(epoch from (d.end_time - d.start_time)) * 1000)::int as avg_ms,
           max(extract(epoch from (d.end_time - d.start_time)) * 1000)::int as max_ms
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '2 hours' and d.status = 'succeeded'
    group by j.jobname order by avg_ms desc`;
  console.log("job runtime, last 2h (schedule cadence vs actual):");
  for (const r of runs) console.log(`  ${r.jobname.padEnd(22)} runs=${r.runs} avg=${r.avg_ms}ms max=${r.max_ms}ms`);

  const act = await sql<{ pid: number; usename: string | null; dur: string | null; q: string }[]>`
    select pid, usename, now() - query_start as dur, left(query, 55) as q
    from pg_stat_activity
    where state <> 'idle' and pid <> pg_backend_pid() order by query_start`;
  console.log(`\nactive now: ${act.length}`);
  for (const a of act) console.log(`  pid ${a.pid} ${a.usename} ${a.dur} :: ${a.q}`);
} catch (e: any) {
  console.log(`err: ${e.message}`);
} finally {
  await sql.end({ timeout: 5 });
}
