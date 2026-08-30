/**
 * Daily refresh of the grid agent's trading record (the grid_* metric rows).
 *
 * The record replays the agent's advised strategy over a rolling 7d and 30d
 * window, so it must be recomputed or it goes stale (staleness-delete drops
 * rows older than 26h, and the card then renders an explicit absence rather
 * than an outdated record). Scheduled daily at 07:17 UTC by migration 0016.
 *
 * All logic lives in src/lib/grid-record-run.ts, shared with the manual
 * script, so the scheduled run and a manual run cannot drift apart.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { authorizeCron } from "@/lib/cron-auth";
import { runGridRecord } from "@/lib/grid-record-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const sql = postgres(dbUrl, { prepare: false, max: 3, connect_timeout: 10, onnotice: () => {} });
  const startedAt = Date.now();
  try {
    const r = await runGridRecord(sql);
    return NextResponse.json({
      ok: true,
      pool: r.pool,
      pegDevPct: Math.round(r.pegDevPct * 1000) / 1000,
      windows: r.windows.map((w) => ({ window: w.suffix, observations: w.observations, written: w.written.length, summary: w.summary })),
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    // A failed record must be loud, not quietly absent: the response body is
    // what cron-status surfaces, and the metric rows' own staleness-delete
    // makes the failure visible on the card within 26h.
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
