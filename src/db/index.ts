/**
 * Database connection.
 *
 * Supabase specifics that matter:
 *
 *  - Use the Supavisor TRANSACTION-mode pooler on port 6543, not the direct
 *    connection on 5432. Serverless functions each open a connection and will
 *    exhaust the direct limit.
 *  - Transaction-mode pooling does not support prepared statements, so
 *    postgres-js must be created with `prepare: false`. Omitting this produces
 *    intermittent "prepared statement already exists" errors under load —
 *    which look like random failures rather than a config mistake.
 *  - Writes use the service-role connection from the worker only. The app
 *    reads through RLS-protected public policies.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

const url = process.env.DATABASE_URL;

let client: ReturnType<typeof postgres> | null = null;

export function isConfigured() {
  return typeof url === "string" && url.length > 0;
}

export function getClient() {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Use the Supabase transaction-mode pooler URI (port 6543).",
    );
  }
  if (!client) {
    if (url.includes(":5432")) {
      console.warn(
        "[db] DATABASE_URL points at port 5432 (direct). Prefer the transaction-mode pooler on 6543 for serverless.",
      );
    }
    client = postgres(url, {
      // Required for Supavisor transaction mode.
      prepare: false,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return client;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export { schema };
