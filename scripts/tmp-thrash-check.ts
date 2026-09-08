import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });

async function main() {
  try {
    const [to] = await sql<{ v: string | null }[]>`show statement_timeout`;
    console.log(`statement_timeout: ${to?.v}`);

    const [cs] = await sql<{ updated_at: string }[]>`
      select updated_at::text from census_stats where id = 'bsc'`;
    console.log(`census_stats.updated_at: ${cs?.updated_at}`);

    const act = await sql`
      select pid, state, wait_event_type, now() - query_start as running, left(query, 80) as q
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'
      order by query_start asc limit 8`;
    console.log(`\nnon-idle activity:`);
    if (!act.length) console.log(`  (nothing running)`);
    for (const a of act) console.log(`  pid=${a.pid} ${a.state} running=${a.running}  ${a.q}`);

    const fails = await sql`
      select j.jobname, d.status, count(*)::int as n, max(d.start_time)::text as last
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where d.start_time > now() - interval '45 minutes' and d.status <> 'succeeded'
      group by 1, 2 order by n desc limit 8`;
    console.log(`\nfailed cron runs (45 min):`);
    if (!fails.length) console.log(`  (none)`);
    for (const f of fails) console.log(`  ${String(f.jobname).padEnd(18)} ${f.status} x${f.n} last=${String(f.last).slice(11, 19)}`);
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
