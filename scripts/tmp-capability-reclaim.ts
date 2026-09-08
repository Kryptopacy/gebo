/**
 * The 0033 moment: the expression-index search code is DEPLOYED AND VERIFIED
 * (119 matches, 407ms on /search?q=grid, 2026-09-08 01:26 UTC), so the
 * stored capability_doc column can finally drop. Runs the migration, then
 * VACUUM FULL through the SESSION pooler (port 5432) - the transaction
 * pooler silently swallows VACUUM (AGENTS.md, 2026-09-06).
 *
 * This is the coordinated-deploy sequence's last step: 0032 created the
 * expression index, the deploy switched the queries, verification confirmed
 * live search, and only now does the column go.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const txUrl = process.env.DATABASE_URL!;
if (!txUrl) { console.error("DATABASE_URL is not set."); process.exit(1); }
const sessionUrl = txUrl.includes(":6543") ? txUrl.replace(":6543", ":5432") : txUrl;
console.log(`session-pooler swap applied: ${sessionUrl !== txUrl}`);

const sql = postgres(sessionUrl, { prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5, onnotice: () => {} });

async function size(): Promise<string> {
  const [r] = await sql<{ s: string }[]>`
    select pg_size_pretty(pg_database_size(current_database())) as s`;
  return r?.s ?? "?";
}

async function main() {
  console.log(`db before: ${await size()}`);

  // Safety gate: the expression index must exist and be valid before the drop.
  const [idx] = await sql<{ valid: boolean }[]>`
    select i.indisvalid as valid
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'agents_capability_expr_idx'`;
  if (!idx?.valid) {
    console.error(`REFUSING: agents_capability_expr_idx is missing or invalid - dropping the column now would break search.`);
    process.exitCode = 1;
    return;
  }
  console.log(`agents_capability_expr_idx valid: ${idx.valid}`);

  await sql.unsafe(readFileSync("supabase/migrations/0033_drop_capability_doc.sql", "utf8"));
  console.log(`0033 applied: capability_doc column dropped (with its 18 MB fts index)`);
  console.log(`db after drop: ${await size()} (space returns after VACUUM FULL)`);

  console.log(`VACUUM FULL agents (exclusive lock, brief)...`);
  await sql.unsafe("vacuum full analyze public.agents");
  console.log(`db after vacuum: ${await size()}`);

  const [cols] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
    where table_schema = 'public' and table_name = 'agents' and column_name = 'capability_doc'`;
  console.log(`capability_doc columns remaining: ${cols?.n} (want 0)`);
}

main()
  .catch((e: any) => { console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`); process.exitCode = 1; })
  .finally(() => sql.end({ timeout: 5 }));
