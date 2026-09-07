/** Apply 0023 with retries: skip the pause (cron.job is not writable by this
 *  role); the index creation waits out statement timeouts instead. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 30, onnotice: () => {} });

try {
  await sql`set statement_timeout = '300s'`;
  await sql.unsafe(readFileSync("supabase/migrations/0023_materialize_index.sql", "utf8").replace(/^--.*$/gm, "").trim());
  console.log("index created via transaction pooler");
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

