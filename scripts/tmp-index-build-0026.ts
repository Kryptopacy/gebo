/** Build 0026 expression-trigram indexes concurrently, as a background job. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!.replace(":6543", ":5432"), {
  prepare: false, max: 1, connect_timeout: 30, idle_timeout: 60, onnotice: () => {},
});

try {
  await sql.unsafe("set statement_timeout = '900s'");
  const bad = await sql<{ relname: string }[]>`
    select i.relname from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    where i.relname in ('agents_skills_trgm_idx','agents_skills_norm_trgm_idx')
      and not ix.indisvalid`;
  for (const b of bad) {
    await sql.unsafe(`drop index if exists public.${b.relname}`);
    console.log(`dropped invalid leftover: ${b.relname}`);
  }

  for (const stmt of [
    "create index concurrently if not exists agents_skills_trgm_idx on public.agents using gin ((array_to_string(skills, ' ')) gin_trgm_ops)",
    "create index concurrently if not exists agents_skills_norm_trgm_idx on public.agents using gin ((replace(array_to_string(skills, ' '), '-', ' ')) gin_trgm_ops)",
  ]) {
    const t0 = Date.now();
    await sql.unsafe(stmt);
    console.log(`built in ${Date.now() - t0}ms: ${stmt.slice(27, 75)}`);
  }

  const idx = await sql<{ indexname: string; valid: boolean }[]>`
    select i.relname as indexname, ix.indisvalid as valid
    from pg_index ix join pg_class i on i.oid = ix.indexrelid
    where i.relname in ('agents_skills_trgm_idx','agents_skills_norm_trgm_idx')`;
  for (const i of idx) console.log(`${i.indexname}: ${i.valid ? "VALID" : "INVALID"}`);
  const ok = idx.length === 2 && idx.every((i) => i.valid);
  console.log(ok ? "INDEXES COMPLETE" : "INDEXES INCOMPLETE");
  process.exitCode = ok ? 0 : 1;
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
void readFileSync;
