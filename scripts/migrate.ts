/**
 * Apply SQL migrations from supabase/migrations in filename order.
 *
 * Uses postgres-js `.simple()` so the whole file is sent as one simple query.
 * That matters because 0001_init.sql contains a DO $$ ... $$ block whose body
 * has its own semicolons — naive statement splitting corrupts it.
 *
 * Idempotent: every statement in the migrations uses IF NOT EXISTS or
 * DROP ... IF EXISTS, so re-running is safe.
 */
import "dotenv/config";
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

if (!files.length) { console.error(`No .sql files in ${dir}`); process.exit(1); }

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 25,
  idle_timeout: 10,
  // `drop policy if exists` emits a NOTICE per table on a fresh database.
  // Surface warnings and worse; suppress the expected noise.
  onnotice: (n) => {
    if (n.severity !== "NOTICE") console.warn(`  [${n.severity}] ${n.message}`);
  },
});

console.log(`\n  applying ${files.length} migration file(s)\n`);

try {
  for (const f of files) {
    const body = readFileSync(path.join(dir, f), "utf8");
    process.stdout.write(`  ${f} … `);
    const t0 = Date.now();
    await sql.unsafe(body).simple();
    console.log(`ok (${Date.now() - t0} ms)`);
  }

  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `;
  const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `;
  const policies = await sql<{ tablename: string; policyname: string }[]>`
    select tablename, policyname from pg_policies where schemaname = 'public' order by tablename
  `;

  console.log(`\n  tables created: ${tables.length}`);
  const noRls = rls.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  console.log(`  RLS enabled:    ${rls.filter((r) => r.relrowsecurity).length}/${rls.length}` +
    (noRls.length ? `  MISSING on: ${noRls.join(", ")}` : ""));
  console.log(`  policies:       ${policies.length}`);

  console.log("");
  for (const t of tables) {
    const r = rls.find((x) => x.relname === t.table_name);
    const p = policies.filter((x) => x.tablename === t.table_name).length;
    console.log(`    ${t.table_name.padEnd(20)} rls=${r?.relrowsecurity ? "on " : "OFF"}  policies=${p}`);
  }
  console.log("");
} catch (e: any) {
  console.error(`\n  MIGRATION FAILED: ${String(e?.message ?? e).slice(0, 400)}`);
  if (e?.position) console.error(`  at character position ${e.position}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
