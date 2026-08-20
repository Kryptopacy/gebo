/**
 * Inspect the pg_cron schedule and recent run history.
 *
 * The scheduler lives in the database rather than CI or platform cron, so this
 * is how we see whether it is actually firing.
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

try {
  const ext = await sql<{ extname: string; extversion: string }[]>`
    select extname, extversion from pg_extension
    where extname in ('pg_cron', 'pg_net') order by extname
  `;
  console.log(`\n  extensions`);
  if (!ext.length) console.log(`    none installed`);
  for (const e of ext) console.log(`    ${e.extname.padEnd(10)} v${e.extversion}`);

  const secrets = await sql<{ name: string; present: boolean }[]>`
    select 'gebo_site_url'   as name, public.gebo_secret('gebo_site_url')   is not null as present
    union all
    select 'gebo_cron_secret' as name, public.gebo_secret('gebo_cron_secret') is not null as present
  `.catch(() => [] as any[]);
  if (secrets.length) {
    console.log(`\n  vault secrets`);
    for (const s of secrets) console.log(`    ${s.name.padEnd(20)} ${s.present ? "set" : "MISSING"}`);
  }

  const jobs = await sql<{ jobid: number; jobname: string; schedule: string; active: boolean }[]>`
    select jobid, jobname, schedule, active from cron.job
    where jobname like 'gebo-%' order by jobname
  `;
  console.log(`\n  scheduled jobs`);
  if (!jobs.length) console.log(`    none`);
  for (const j of jobs) {
    console.log(`    ${j.jobname.padEnd(22)} ${j.schedule.padEnd(14)} active=${j.active}`);
  }

  const runs = await sql<any[]>`
    select j.jobname, r.status, r.start_time, r.return_message
    from cron.job_run_details r
    join cron.job j on j.jobid = r.jobid
    where j.jobname like 'gebo-%'
    order by r.start_time desc limit 12
  `.catch(() => [] as any[]);
  console.log(`\n  recent runs`);
  if (!runs.length) console.log(`    no history yet (jobs fire on their next tick)`);
  for (const r of runs) {
    const when = new Date(r.start_time).toISOString().slice(11, 19);
    const msg = (r.return_message ?? "").toString().slice(0, 60);
    console.log(`    ${when}  ${r.jobname.padEnd(22)} ${String(r.status).padEnd(10)} ${msg}`);
  }

  const net = await sql<any[]>`
    select status_code, count(*)::int as n
    from net._http_response
    where created > now() - interval '1 hour'
    group by status_code order by n desc limit 6
  `.catch(() => [] as any[]);
  if (net.length) {
    console.log(`\n  pg_net responses (last hour)`);
    for (const r of net) console.log(`    ${String(r.status_code ?? "null").padEnd(6)} ${r.n}`);
  }
  console.log("");
} catch (e: any) {
  console.error(`\n  FAILED: ${String(e?.message ?? e).slice(0, 300)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
