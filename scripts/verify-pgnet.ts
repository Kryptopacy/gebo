/**
 * Verify pg_net actually still delivers HTTP requests.
 *
 * This is the gate on migration 0012. pg_net had to be dropped and recreated to
 * leave the public schema, and its send path is asynchronous: net.http_get queues
 * a request and returns void, then a background worker performs it. So the
 * dangerous outcome is not an error, it is silence - every cron job continues to
 * report "succeeded" because queueing succeeded, while no request is ever made and
 * the entire data pipeline quietly stops with all dashboards looking healthy.
 *
 * A migration cannot check this itself: it would have to wait on an asynchronous
 * worker inside its own transaction, where the queued row is not yet visible to the
 * worker. Hence a separate script, run after the migration commits.
 *
 * Exits non-zero when the worker is not delivering, so it can gate a deploy.
 *
 * Run: npm run verify:pgnet
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

/** Something cheap, public and reliably fast. Also a surface GEBO already reads. */
const TARGET =
  "https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar/resources?limit=1&offset=0";

try {
  const [ext] = await sql<{ extversion: string; schema: string }[]>`
    select e.extversion, n.nspname as schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net'`;

  if (!ext) {
    console.error("\n  pg_net is NOT INSTALLED. Every cron job is inert.\n");
    process.exit(1);
  }

  console.log(`\n  pg_net ${ext.extversion} registered in schema "${ext.schema}"`);
  console.log(
    ext.schema === "public"
      ? `    still in public: migration 0012 has not run or did not take effect`
      : `    out of public, which is what the linter asked for`,
  );

  const fns = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname in ('http_get', 'http_post', 'http_collect_response')`;
  console.log(`    net.http_* functions present: ${fns[0]?.n ?? 0} of 3`);

  // Nothing pg_net owns may live in public, which is the actual lint condition.
  const inPublic = await sql<{ name: string }[]>`
    select c.relname as name
    from pg_depend d
    join pg_extension e on e.oid = d.refobjid and e.extname = 'pg_net'
    join pg_class c on c.oid = d.objid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    union all
    select p.proname
    from pg_depend d
    join pg_extension e on e.oid = d.refobjid and e.extname = 'pg_net'
    join pg_proc p on p.oid = d.objid
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'`;
  console.log(`    objects owned by pg_net inside public: ${inPublic.length}`);

  console.log(`\n  END-TO-END DELIVERY TEST`);
  const [q] = await sql<{ id: number }[]>`
    select net.http_get(url := ${TARGET}, timeout_milliseconds := 15000) as id`;
  const id = q?.id;
  if (id == null) {
    console.error("    http_get returned no request id\n");
    process.exit(1);
  }
  console.log(`    queued request ${id}, waiting for the worker`);

  let seen: { status_code: number | null; error_msg: string | null } | null = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const rows = await sql<{ status_code: number | null; error_msg: string | null }[]>`
      select status_code, error_msg from net._http_response where id = ${id}`;
    if (rows.length) { seen = rows[0]!; break; }
  }

  if (!seen) {
    const [depth] = await sql<{ n: number }[]>`select count(*)::int as n from net.http_request_queue`;
    console.error(`\n    NO RESPONSE within 30s. Queue depth ${depth?.n}.`);
    console.error(`    The worker is not delivering. Every gebo cron job will report`);
    console.error(`    "succeeded" while making no HTTP request at all. Try:`);
    console.error(`      select net.worker_restart();`);
    console.error(`    and if that does not help, reinstall pg_net in public to restore service.\n`);
    process.exit(1);
  }

  if (seen.error_msg) {
    console.error(`\n    Response carried an error: ${seen.error_msg}\n`);
    process.exit(1);
  }

  console.log(`    delivered: HTTP ${seen.status_code}`);

  // The scheduler itself is the thing that matters. Report its recent verdicts.
  const runs = await sql<{ jobname: string; status: string; start_time: string }[]>`
    select j.jobname, d.status, d.start_time::text
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '20 minutes'
    order by d.start_time desc limit 10`;
  console.log(`\n  CRON RUNS IN THE LAST 20 MINUTES`);
  if (!runs.length) console.log(`    none recorded`);
  for (const r of runs) {
    console.log(`    ${r.start_time.slice(11, 19)}  ${r.jobname.padEnd(20)} ${r.status}`);
  }
  const failed = runs.filter((r) => r.status !== "succeeded");
  console.log(
    failed.length === 0
      ? `\n  pg_net is delivering and the scheduler is healthy.\n`
      : `\n  ${failed.length} recent run(s) did not succeed; inspect before trusting this.\n`,
  );
} catch (e: any) {
  console.error(`\n  FAILED: ${String(e?.message ?? e).slice(0, 240)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
