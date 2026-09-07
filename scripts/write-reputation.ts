/**
 * Publish measured liveness to the ERC-8004 Reputation Registry.
 *
 * This is the CLI front to src/lib/reputation-producer.ts, which is also the
 * cron route (app/api/cron/reputation) - one implementation, two entry
 * points, so a manual run and a scheduled run cannot drift. The gates
 * (publishable(), already-written skip, population veto) live in the shared
 * module; see its header for why each exists.
 *
 * IRREVERSIBLE, SO THE GATE COMES FIRST. The spec notes on-chain feedback
 * pointers cannot be deleted, so a wrong negative permanently misrepresents
 * a working agent.
 *
 * Run: npx tsx scripts/write-reputation.ts              (dry run, writes nothing)
 *      npx tsx scripts/write-reputation.ts --publish    (sends transactions)
 *      npx tsx scripts/write-reputation.ts --publish --limit 3
 */
import "dotenv/config";
import postgres from "postgres";
import { runReputationWriteBack } from "../src/lib/reputation-producer.ts";
import { REPUTATION_REGISTRY } from "../src/lib/reputation.ts";

const PUBLISH = process.argv.includes("--publish");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1] ?? 5)) : 5;
})();
const WINDOW_DAYS = 7;

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, onnotice: () => {} });

console.log(`\n  ERC-8004 REPUTATION WRITE-BACK`);
console.log(`  registry ${REPUTATION_REGISTRY[56]}`);
console.log(`  window   ${WINDOW_DAYS} days`);
console.log(`  mode     ${PUBLISH ? "PUBLISH (irreversible)" : "dry run"}\n`);

try {
  const summary = await runReputationWriteBack({
    sql,
    publish: PUBLISH,
    limit: LIMIT,
    windowDays: WINDOW_DAYS,
    writerKey: process.env.REPUTATION_WRITER_PRIVATE_KEY ?? null,
    log: (line) => console.log(`  ${line}`),
  });
  console.log(`  population failure rate ${(summary.populationFailureRate * 100).toFixed(1)}%`);
  console.log(
    `\n  ${PUBLISH ? `${summary.published} published, ${summary.skipped} skipped.` : "Dry run: nothing written."}` +
    (summary.skippedReason ? `  ${summary.skippedReason}` : ""),
  );
  if (summary.candidates === 0) console.log("  No agent has 20+ probes in the window yet.");
} finally {
  await sql.end({ timeout: 5 });
}
