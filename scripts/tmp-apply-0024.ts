/** Apply 0024 (self-guarding refresh_census_stats). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!.replace(":6543", ":5432"), { prepare: false, max: 1, connect_timeout: 30, onnotice: () => {} });

try {
  await sql`set statement_timeout = '300s'`;
  await sql.unsafe(readFileSync("supabase/migrations/0024_stats_refresh_selfguard.sql", "utf8"));
  console.log("self-guarding refresh applied");
} catch (e: any) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
