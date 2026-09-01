/**
 * Apply migration 0017 (verified_reviews) through the same connection the
 * cron jobs write through. Idempotent DDL: create if not exists / drop-if-exists
 * policies, safe to re-run.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
const path = "supabase/migrations/0017_verified_reviews.sql";
const ddl = readFileSync(path, "utf8");

try {
  await sql.unsafe(ddl);
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = 'verified_reviews'
  `;
  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'verified_reviews'
    order by ordinal_position
  `;
  console.log(`table: ${rows.length ? rows[0]!.table_name : "(missing)"}`);
  console.log(`columns: ${cols.map((c) => c.column_name).join(", ")}`);
  const policies = await sql<{ policyname: string }[]>`
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'verified_reviews'
  `;
  console.log(`policies: ${policies.map((p) => p.policyname).join(", ") || "(none)"}`);
} catch (e: any) {
  console.error(`migration failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
