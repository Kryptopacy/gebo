/**
 * The SUSTAINABLE free-tier fleet (2026-09-08, second throttle within three
 * hours of full restoration - the full fleet empirically does not fit the
 * tier at 257k agents, even at 0037 cadences).
 *
 * Roughly a third of the previous load:
 *   resolve      every 1 min  -> every 5  (mints ~1.5k/day; capacity stays far beyond need)
 *   materialize  every 3 min  -> every 5
 *   sync         every 5 min  -> every 15
 *   probe        every 5 min  -> every 10
 *   counts       every 15 min -> every 30 (COUNTS_STALE_MS 45min covers two missed runs)
 *   classify, opportunities, sessions stay UNSCHEDULED until the tier can
 *   carry them or Pro is enabled - their data staleness is disclosed by
 *   updated_at / observation counts wherever rendered.
 *
 * Run after a stand-down + drain. Everything is reversible; the full-fleet
 * values remain in git history and AGENTS.md.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });

const SCHEDULES: [string, string, string | null][] = [
  ["gebo-resolve", "*/5 * * * *", "/api/cron/resolve"],
  ["gebo-materialize", "*/5 * * * *", "/api/cron/materialize"],
  ["gebo-sync", "*/15 * * * *", "/api/cron/sync"],
  ["gebo-probe", "*/10 * * * *", "/api/cron/probe"],
  ["gebo-counts", "*/30 * * * *", null], // direct SQL
];

async function main() {
  try {
    for (const [name, schedule, route] of SCHEDULES) {
      const cmd = route
        ? `select cron.schedule('${name}', '${schedule}', $$select public.gebo_run_cron('${route}')$$);`
        : `select cron.schedule('${name}', '${schedule}', $$select public.refresh_registry_counts()$$);`;
      await sql.unsafe(cmd);
      console.log(`scheduled ${name} [${schedule}]`);
    }
    // classify / opportunities / sessions: deliberately left off on the free tier
    for (const name of ["gebo-classify", "gebo-opportunities", "gebo-sessions"]) {
      await sql`select cron.unschedule(${name})`;
      console.log(`unscheduled ${name} (free-tier budget)`);
    }
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
