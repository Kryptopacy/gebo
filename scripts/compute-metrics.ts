/**
 * One-shot backfill of liveness metrics, for local runs and verification.
 * The probe cron recomputes every batch; this exists so the numbers exist
 * before the next cron tick and so a human can re-run after a schema fix.
 */
import "dotenv/config";
import postgres from "postgres";
import { computeLivenessMetrics } from "../src/lib/metrics.ts";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 2, connect_timeout: 15 });

try {
  const r = await computeLivenessMetrics(sql);
  console.log(`  metric_values now holds ${r.written} values across ${r.agents} agents (window 7d, floor 20 probes)`);
} finally {
  await sql.end({ timeout: 5 });
}
