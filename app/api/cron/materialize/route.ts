/**
 * Cron endpoint: materialize resolved census rows into the product tables.
 *
 * Search, category pages, agent cards and the prober read `agents` and
 * `agent_endpoints`, never `registry_tokens`. Before this endpoint existed
 * those tables were only refreshed by hand-run loaders, so the product layer
 * silently froze at token #269686 while the census ran on — newly registered
 * agents were censused and resolved yet invisible (found 2026-09-06, when an
 * agent launched through Binance Agent OS did not appear in search).
 *
 * Newest-first, so a fresh registration surfaces within minutes of its census
 * entry. The probe and classify crons pick the new rows up from there: probing
 * promotes DORMANT → VERIFIED/LISTED within minutes, classification runs on
 * its fingerprint schedule.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { authorizeCron } from "@/lib/cron-auth";
import { materializeSlice } from "@/lib/materialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const sql = postgres(url, { prepare: false, max: 4, connect_timeout: 10, onnotice: () => {} });

  try {
    const out = await materializeSlice(sql, {
      // Slice above the old 80: the route is the primary materializer now
      // (migration 0020), and the 45s budget — not the slice — is the real
      // bound; a bigger slice just lets fast batches (data: URIs) do more.
      slice: Number(process.env.CRON_MATERIALIZE_SLICE ?? 200),
      concurrency: 10,
      timeBudgetMs: 45_000,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
