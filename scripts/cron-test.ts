/**
 * Did the cron secret rotation actually work?
 *
 * "succeeded" in cron.job_run_details is not the test. gebo_run_cron calls
 * net.http_get, which QUEUES a request and returns void, so the job succeeds
 * whatever the endpoint replies. A mismatched secret produces a perfect run log and
 * a completely stopped pipeline - the silent-failure shape this codebase keeps
 * finding.
 *
 * The real evidence is net._http_response: the status code the deployed app
 * actually returned. 200 means Vault and Vercel agree. 401 means they do not.
 *
 * Never prints either secret. Fingerprints only.
 *
 * Run: npm run cron:test
 */
import "dotenv/config";
import postgres from "postgres";
import { createHash } from "node:crypto";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [v] = await sql<{ secret: string | null; site: string | null }[]>`
    select public.gebo_secret('gebo_cron_secret') as secret,
           public.gebo_secret('gebo_site_url')    as site`;

  if (!v?.secret) {
    console.error("\n  gebo_cron_secret is absent from Vault. Every cron job is inert.\n");
    process.exit(1);
  }

  const fp = createHash("sha256").update(v.secret, "utf8").digest("hex").slice(0, 16);
  console.log(`\n  VAULT`);
  console.log(`    gebo_cron_secret    length ${v.secret.length}, fingerprint ${fp}`);
  if (v.secret !== v.secret.trim()) {
    console.log(`    WARNING: surrounding whitespace present; this alone causes a 401`);
  }
  console.log(`    gebo_site_url       ${v.site ?? "(missing)"}`);

  /**
   * What the endpoints actually replied.
   *
   * pg_net reaps _http_response on a TTL, so this window is short by design -
   * which is fine, because a short window is exactly what tells us about the
   * CURRENT secret rather than a historical one.
   */
  const responses = await sql<{ status_code: number | null; n: number; newest: string }[]>`
    select status_code, count(*)::int as n, max(created)::text as newest
    from net._http_response
    where created > now() - interval '30 minutes'
    group by status_code
    order by n desc`;

  console.log(`\n  HTTP RESPONSES THE SCHEDULER RECEIVED  (last 30 min)`);
  if (!responses.length) {
    console.log(`    none recorded yet. pg_net reaps responses on a TTL, so wait for the`);
    console.log(`    next tick (resolve runs every minute) and re-run.`);
  }
  for (const r of responses) {
    const verdict =
      r.status_code === 200 ? "OK - Vault and Vercel agree"
      : r.status_code === 401 ? "REJECTED - the two secrets do not match"
      : r.status_code === 404 ? "route missing - is that endpoint deployed?"
      : r.status_code === 503 ? "app refused - CRON_SECRET unset in Vercel?"
      : "unexpected";
    console.log(`    ${String(r.status_code ?? "none").padEnd(6)} x${String(r.n).padEnd(4)} newest ${r.newest.slice(11, 19)}  ${verdict}`);
  }

  const errors = await sql<{ error_msg: string; n: number }[]>`
    select error_msg, count(*)::int as n
    from net._http_response
    where created > now() - interval '30 minutes' and error_msg is not null
    group by error_msg order by n desc limit 5`;
  if (errors.length) {
    console.log(`\n  TRANSPORT ERRORS`);
    for (const e of errors) console.log(`    x${e.n}  ${e.error_msg.slice(0, 90)}`);
  }

  const runs = await sql<{ jobname: string; status: string; start_time: string }[]>`
    select j.jobname, d.status, d.start_time::text
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '15 minutes'
    order by d.start_time desc limit 8`;
  console.log(`\n  SCHEDULER RUN LOG  (says nothing about the HTTP result - see above)`);
  for (const r of runs) console.log(`    ${r.start_time.slice(11, 19)}  ${r.jobname.padEnd(20)} ${r.status}`);

  /**
   * The only measurement that cannot be faked: is data still arriving? If probes
   * stopped growing, the pipeline is down whatever every other line here says.
   */
  const [fresh] = await sql<{ probes_5m: number; probes_60m: number; newest: string | null }[]>`
    select
      count(*) filter (where at > now() - interval '5 minutes')::int  as probes_5m,
      count(*) filter (where at > now() - interval '60 minutes')::int as probes_60m,
      max(at)::text as newest
    from probes_raw`;
  console.log(`\n  IS DATA STILL ARRIVING`);
  console.log(`    probes in last 5 min    ${fresh?.probes_5m}`);
  console.log(`    probes in last 60 min   ${fresh?.probes_60m}`);
  console.log(`    newest probe            ${fresh?.newest ?? "none"}`);

  const ok200 = responses.find((r) => r.status_code === 200)?.n ?? 0;
  const bad = responses.filter((r) => r.status_code !== 200).reduce((n, r) => n + r.n, 0);
  const flowing = (fresh?.probes_60m ?? 0) > 0;

  /**
   * The verdict has to be temporal, not a count.
   *
   * A rotation necessarily produces rejections: between updating Vault and Vercel
   * finishing its redeploy, the two secrets disagree and every tick is refused.
   * Those 401s are evidence the rotation happened, not that it failed. Counting any
   * 401 in the window as a failure would raise an alarm after every successful
   * rotation, and an alarm that always fires is an alarm nobody reads.
   *
   * What matters is whether the LATEST authorised call is newer than the latest
   * rejection. If it is, the mismatch is behind us.
   */
  const newestOk = responses.find((r) => r.status_code === 200)?.newest ?? null;
  const newestBad = responses
    .filter((r) => r.status_code !== 200)
    .map((r) => r.newest)
    .sort()
    .at(-1) ?? null;
  const recovered = !!newestOk && (!newestBad || newestOk > newestBad);

  console.log("");
  if (ok200 > 0 && recovered && flowing) {
    if (bad > 0) {
      console.log(`  Rotation succeeded. ${bad} rejection(s) at ${newestBad?.slice(11, 19)} predate the`);
      console.log(`  latest authorised call at ${newestOk?.slice(11, 19)}, which is the expected window`);
      console.log(`  between the Vault update and Vercel finishing its redeploy.`);
    }
    console.log(`  ${ok200} authorised call(s), data flowing: ${fresh?.probes_5m} probe(s) in the last 5 min.\n`);
  } else if (bad > 0 && !recovered) {
    console.log(`  Still being rejected: the newest call at ${newestBad?.slice(11, 19)} was not accepted.`);
    console.log(`  Check the Vercel CRON_SECRET against the fingerprint above, and that the`);
    console.log(`  project was REDEPLOYED after the env change - Vercel does not apply env`);
    console.log(`  edits to an existing build.\n`);
    process.exitCode = 1;
  } else if (!flowing) {
    console.log(`  No probes in an hour. The pipeline is stopped regardless of the run log.\n`);
    process.exitCode = 1;
  } else {
    console.log(`  Inconclusive: no HTTP responses in the window yet, but data is arriving.\n`);
  }
} catch (e: any) {
  console.error(`\n  FAILED: ${String(e?.message ?? e).slice(0, 240)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
