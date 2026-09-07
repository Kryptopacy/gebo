/**
 * One-off space surgery (accompanies migration 0031), 2026-09-07.
 *
 * Does the parts a migration cannot: the batched mass nulling of the
 * token_uri cache and the VACUUM FULLs. VACUUM FULL must run through the
 * SESSION pooler (port 5432): through the transaction pooler (6543) it
 * reports success and does nothing - measured 2026-09-06, AGENTS.md.
 *
 * VACUUM FULL takes an exclusive lock per table for its duration (tens of
 * seconds at these sizes); the materialize/probe crons queue briefly behind
 * it and self-heal on their next tick.
 */
import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";

const txUrl = process.env.DATABASE_URL!;
if (!txUrl) { console.error("DATABASE_URL is not set."); process.exit(1); }
// Same pooler host, session mode. Never print the URL - it carries the password.
const sessionUrl = txUrl.includes(":6543") ? txUrl.replace(":6543", ":5432") : txUrl;
console.log(`session-pooler swap applied: ${sessionUrl !== txUrl}`);

const sql = postgres(sessionUrl, {
  prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5, onnotice: () => {},
});

async function size(): Promise<string> {
  const [r] = await sql<{ s: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as s`;
  return r?.s ?? "?";
}

async function main() {
  console.log(`database before: ${await size()}`);

  console.log(`applying 0031 (index drops, skills_text fix, gebo-maint schedule)...`);
  await sql.unsafe(readFileSync("supabase/migrations/0031_space_surgery.sql", "utf8"));
  console.log(`  after migration: ${await size()}`);

  console.log(`nulling token_uri cache on resolved+materialized rows (batched)...`);
  let total = 0;
  while (true) {
    const r = await sql`
      update registry_tokens set token_uri = null, checked_at = now()
      where ctid in (
        select ctid from registry_tokens
        where token_uri is not null and resolved
          and exists (select 1 from agents a
                      where a.chain_id = 56 and a.token_id = registry_tokens.token_id)
        limit 10000
      )
      returning 1 as x`;
    if (!r.length) break;
    total += r.length;
    if (total % 50000 === 0) console.log(`  ${total} rows nulled, db at ${await size()}`);
  }
  console.log(`  nulled ${total} rows; db at ${await size()} (space returns after VACUUM FULL)`);

  console.log(`cron history retention (one-off; gebo-maint keeps it)...`);
  const h = await sql`delete from cron.job_run_details where start_time < now() - interval '7 days'`;
  console.log(`  ${h.count} rows deleted; db at ${await size()}`);

  console.log(`VACUUM FULL registry_tokens (exclusive lock, brief)...`);
  await sql.unsafe("vacuum full analyze public.registry_tokens");
  console.log(`  db at ${await size()}`);

  console.log(`VACUUM FULL agents (exclusive lock, brief)...`);
  await sql.unsafe("vacuum full analyze public.agents");
  console.log(`  db at ${await size()}`);

  const [counts] = await sql<{ token_uri: number }[]>`
    select count(*)::int as token_uri from registry_tokens where token_uri is not null`;
  console.log(`\nremaining non-null token_uri rows (unmaterialized/unresolved tail): ${counts?.token_uri}`);
  console.log(`final: ${await size()}`);
}

main()
  .catch((e: any) => { console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`); process.exitCode = 1; })
  .finally(() => sql.end({ timeout: 5 }));
