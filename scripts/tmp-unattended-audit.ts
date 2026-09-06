/**
 * Unattended-window risk audit, measured not assumed. The project must run
 * itself Sep 6 - Nov 5 with nobody watching. Read-only.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [db] = await sql<{ size: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as size`;
  const tables = await sql<{ relname: string; rows: string; size: string }[]>`
    select relname, n_live_tup::text as rows, pg_size_pretty(pg_total_relation_size(relid)) as size
    from pg_stat_user_tables
    order by pg_total_relation_size(relid) desc limit 10`;
  console.log(`database size: ${db?.size}`);
  for (const t of tables) console.log(`  ${t.relname.padEnd(24)} ${t.rows.padStart(9)} rows  ${t.size}`);

  const [growth] = await sql<{ probe_daily_day: number; probes_raw: number; endpoints: number; agents: number }[]>`
    select
      (select count(*)::int from probe_daily where day > current_date - 1) as probe_daily_day,
      (select count(*)::int from probes_raw) as probes_raw,
      (select count(*)::int from agent_endpoints where chain_id = 56) as endpoints,
      (select count(*)::int from agents where chain_id = 56) as agents`;
  console.log(`\nendpoints: ${growth?.endpoints.toLocaleString()} | agents: ${growth?.agents.toLocaleString()}`);
  console.log(`probe_daily rows yesterday: ${growth?.probe_daily_day.toLocaleString()} | probes_raw (48h rotation): ${growth?.probes_raw.toLocaleString()}`);

  const [proj] = await sql<{ b: string }[]>`
    select pg_size_pretty(pg_total_relation_size('probe_daily') + pg_total_relation_size('probes_raw') + pg_total_relation_size('probe_events')) as b`;
  console.log(`probe tables total now: ${proj?.b}`);

  const crons = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active from cron.job order by jobname`;
  console.log(`\nscheduled jobs: ${crons.length}`);
  for (const c of crons) console.log(`  ${c.active ? "active" : "INACTIVE"}  ${c.jobname}  [${c.schedule}]`);

  const failures = await sql<{ jobname: string; n: number; latest: string }[]>`
    select jobname, count(*)::int as n, max(end_time)::text as latest
    from cron.job_run_details
    where status = 'failed' and end_time > now() - interval '7 days'
    group by jobname order by n desc`;
  console.log(`\nfailed cron runs (7d): ${failures.length ? "" : "none"}`);
  for (const f of failures) console.log(`  ${f.jobname}: ${f.n} (latest ${f.latest})`);
} catch (e: any) {
  console.error(`query failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
