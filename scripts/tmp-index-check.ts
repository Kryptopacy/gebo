/** What indexes exist on agents/registry_tokens, and what column types? */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 30, onnotice: () => {} });

try {
  const cols = await sql<{ column_name: string; data_type: string }[]>`
    select column_name, data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'agents' and column_name in ('capability_doc', 'name', 'skills')`;
  for (const c of cols) console.log(`${c.column_name}: ${c.data_type}`);

  const idx = await sql<{ indexname: string; indexdef: string }[]>`
    select indexname, indexdef from pg_indexes
    where tablename in ('agents', 'registry_tokens') order by tablename, indexname`;
  for (const i of idx) console.log(`${i.indexdef}`);
} catch (e: any) {
  console.log(`err: ${e.message}`);
} finally {
  await sql.end({ timeout: 5 });
}
