/**
 * Apply 0032 (concurrent expression index), then report its validity and
 * the size it added. Safe to run while the crons write - CONCURRENTLY never
 * blocks them.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
try {
  const [before] = await sql<{ s: string }[]>`select pg_size_pretty(pg_database_size(current_database())) as s`;
  console.log(`db before: ${before?.s}`);

  await sql.unsafe(readFileSync("supabase/migrations/0032_capability_expression_index.sql", "utf8").replace(/^--.*$/gm, "").trim() + ";");
  const idx = await sql<{ valid: boolean; size: string }[]>`
    select i.indisvalid as valid, pg_size_pretty(pg_relation_size(c.oid)) as size
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'agents_capability_expr_idx'`;
  console.log(`agents_capability_expr_idx: valid=${idx[0]?.valid} size=${idx[0]?.size}`);

  const [after] = await sql<{ s: string }[]>`select pg_size_pretty(pg_database_size(current_database())) as s`;
  console.log(`db after: ${after?.s}`);
  if (!idx[0]?.valid) {
    console.error(`INDEX IS INVALID (interrupted build). Drop it and rerun this script.`);
    process.exitCode = 1;
  }
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
