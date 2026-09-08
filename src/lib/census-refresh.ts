/**
 * Guard for the census-stats refresh: the funnel is one full-table
 * aggregation over 337k+ rows (30-90s on the free tier), and it used to run
 * at the end of EVERY sync/resolve pass - crons that fire every minute.
 * Overlapping refreshes saturated the pooler and queued every user-facing
 * query behind them (found 2026-09-07: search timed out while three
 * refreshes ran concurrently).
 *
 * The funnel renders with a measured_at qualifier, so it does not need
 * minute freshness - it needs non-stale freshness. The gate is the table
 * itself (census_stats.updated_at), NOT a module timestamp: each cron run
 * is a fresh serverless instance, so in-memory state dedupes nothing in
 * production. A no-op cron pass (nothing added/resolved) skips the refresh
 * entirely.
 *
 * The interval is 30 minutes, relaxed from 10 on 2026-09-08: the morning
 * mint wave plus this aggregate plus gebo-counts saturated the free tier's
 * CPU (every cron query 50x slow, zero locks - pure contention), and two
 * full-table scans per hour is the honest free-tier budget. The funnel
 * figures move by fractions of a percent between runs; measured_at travels
 * with them.
 */
import type postgres from "postgres";

const REFRESH_MIN_INTERVAL_MS = 30 * 60 * 1000;

export async function refreshCensusStatsIfDue(
  sql: ReturnType<typeof postgres>,
  opts: { changed: boolean; force?: boolean } = { changed: true },
): Promise<{ refreshed: boolean; skipped: "unchanged" | "interval" | null }> {
  if (!opts.changed && !opts.force) return { refreshed: false, skipped: "unchanged" };
  if (!opts.force) {
    try {
      const [row] = await sql<{ updated_at: Date | string | null }[]>`
        select updated_at from census_stats where id = 'bsc'`;
      const last = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
      if (Date.now() - last < REFRESH_MIN_INTERVAL_MS) {
        return { refreshed: false, skipped: "interval" };
      }
    } catch {
      // If the staleness read fails, refresh anyway: the funnel is more
      // useful slightly stale than never refreshed, and the next pass re-checks.
    }
  }
  await sql`select public.refresh_census_stats()`;
  return { refreshed: true, skipped: null };
}
