/** Apply 0034 (session index columns, checkpoints table, gebo-sessions cron). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync("supabase/migrations/0034_session_index.sql", "utf8"));
  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'source'`;
  const [job] = await sql<{ schedule: string; active: boolean }[]>`
    select schedule, active from cron.job where jobname = 'gebo-sessions'`;
  const [ck] = await sql<{ n: number }[]>`
    select count(*)::int as n from index_checkpoints`;
  console.log(`sessions.source present: ${cols.length > 0}`);
  console.log(`gebo-sessions: [${job?.schedule}] active=${job?.active}`);
  console.log(`index_checkpoints rows: ${ck?.n}`);
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
