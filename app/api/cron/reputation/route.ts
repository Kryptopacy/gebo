/**
 * Scheduled ERC-8004 reputation write-back (spec: writeback:erc8004).
 *
 * The write-back was a hand-run script; 7 writes total was a proof, not a
 * producer. This route runs the same logic (src/lib/reputation-producer.ts,
 * shared with scripts/write-reputation.ts so the two cannot drift) on the
 * 6-hour schedule from migration 0030, bounded to LIMIT writes per run:
 * on-chain feedback is irreversible, so cadence is deliberately modest and
 * every gate (probe floor, population veto, already-written skip) lives in
 * the shared module where the CLI already exercises it.
 *
 * A missing writer key or empty wallet is a 200 with an explicit skipped
 * reason - the run happened and reports honestly what it could not do,
 * rather than a 500 that reads as a defect. Real errors are 500s.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { authorizeCron } from "@/lib/cron-auth";
import { runReputationWriteBack } from "@/lib/reputation-producer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMIT = 3;
const WINDOW_DAYS = 7;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const sql = postgres(url, { prepare: false, max: 3, connect_timeout: 10, onnotice: () => {} });
  try {
    const startedAt = Date.now();
    const summary = await runReputationWriteBack({
      sql,
      publish: true,
      limit: LIMIT,
      windowDays: WINDOW_DAYS,
      writerKey: process.env.REPUTATION_WRITER_PRIVATE_KEY ?? null,
      // Stay well inside maxDuration: BSC blocks are ~1s, three writes with
        // retries still fit in a fraction of this.
      receiptTimeoutMs: 30_000,
    });
    return NextResponse.json({
      ok: summary.ok,
      published: summary.published,
      skipped: summary.skipped,
      candidates: summary.candidates,
      populationFailureRate: Number((summary.populationFailureRate * 100).toFixed(1)),
      skippedReason: summary.skippedReason,
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
