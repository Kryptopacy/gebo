/**
 * Database size surgery, 2026-09-06. The free tier is 500 MB and the database
 * measured 427 MB with the backfill mid-flight. Two leaks:
 *   1. probes_raw promised a 48h rotation that no code ever implemented -
 *      18 days / 200 MB accumulated (~13k rows/day).
 *   2. materialize stored the full registration JSON per agent (~875 chars
 *      x 42k rows and climbing) - the loaders never did, and nothing reads it.
 *
 * This reclaims both. VACUUM FULL is the only reclaim that returns space to
 * the quota; it needs a brief exclusive lock, which the crons tolerate (a
 * failed minute retries; everything here is idempotent).
 */
import "dotenv/config";
import postgres from "postgres";

const txUrl = process.env.DATABASE_URL!;

// VACUUM cannot run in a transaction block; the transaction-mode pooler
// usually passes single statements through, but fall back to the session
// pooler (port 5432) if it refuses. A one-off script is exactly what the
// direct connection is for.
function sessionUrl(url: string): string {
  return url.replace(":6543", ":5432");
}

async function vacuum(table: string) {
  for (const u of [txUrl, sessionUrl(txUrl)]) {
    const sql = postgres(u, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });
    try {
      await sql.unsafe(`VACUUM FULL ${table}`);
      console.log(`  VACUUM FULL ${table}: ok (${u.includes(":6543") ? "transaction pooler" : "session pooler"})`);
      return;
    } catch (e: any) {
      console.log(`  VACUUM FULL ${table} via ${u.includes(":6543") ? "tx" : "session"} pooler: ${String(e?.message ?? e).slice(0, 90)}`);
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }
  throw new Error(`could not VACUUM FULL ${table} through either pooler`);
}

const sql = postgres(txUrl, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [before] = await sql<{ size: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log(`database size before: ${before?.size}`);

  const del = await sql`delete from probes_raw where at < now() - interval '48 hours'`;
  console.log(`probes_raw rows deleted: ${del.count.toLocaleString()}`);
  await vacuum("probes_raw");

  const upd = await sql`
    update agents set registration_json = null, token_uri = left(coalesce(token_uri, ''), 500)
    where registration_json is not null or length(coalesce(token_uri, '')) > 500`;
  console.log(`agents rows slimmed: ${upd.count.toLocaleString()}`);
  await vacuum("agents");

  // registry_tokens carries healed URIs capped at 500 chars; compact it too.
  await vacuum("registry_tokens");

  const [after] = await sql<{ size: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as size`;
  const [sz] = await sql<{ a: string; p: string }[]>`
    select pg_size_pretty(pg_total_relation_size('agents')) as a,
           pg_size_pretty(pg_total_relation_size('probes_raw')) as p`;
  console.log(`database size after:  ${after?.size}`);
  console.log(`agents now ${sz?.a}, probes_raw now ${sz?.p}`);
} catch (e: any) {
  console.error(`surgery failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
