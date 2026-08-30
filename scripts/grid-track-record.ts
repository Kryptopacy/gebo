/**
 * Manual entry point for the grid agent's trading record. All logic lives in
 * src/lib/grid-record-run.ts, shared with /api/cron/grid-record so the manual
 * run and the scheduled run can never drift apart.
 *
 * Run: npx tsx scripts/grid-track-record.ts [--dry]
 */
import "dotenv/config";
import postgres from "postgres";
import { runGridRecord } from "../src/lib/grid-record-run.ts";

const DRY = process.argv.slice(2).includes("--dry");

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, onnotice: () => {} });

try {
  const r = await runGridRecord(sql, { dry: DRY, log: (l) => console.log(l) });
  console.log(`\n  GRID TRADING RECORD - ${r.pool.label} (${r.pool.ref}), ${r.pool.feePct ?? "?"}% fee tier`);
  console.log(`  ${"=".repeat(70)}`);
  for (const w of r.windows) {
    console.log(`\n  WINDOW ${w.suffix}  ${w.observations} observations`);
    console.log(`    ${w.summary}`);
    for (const x of w.written) console.log(`    ${x.metricId.padEnd(24)} ${x.value}`);
  }
  console.log(`\n  ${DRY ? "Dry run: nothing written." : `Wrote ${r.windows.reduce((s, w) => s + w.written.length, 0)} rows.`}`);
  console.log(`  The market graded the strategy; this only reports it.\n`);
} catch (e) {
  console.error(`  ${String((e as Error).message ?? e)}\n`);
  await sql.end();
  process.exit(1);
}
await sql.end({ timeout: 5 });
