/**
 * Backfill: materialize every resolved+named census row into agents, walking
 * from the newest token downward so the live mint wave surfaces first, then
 * the older backlog. Uses the same materializeSlice the cron runs, with a
 * bigger slice and no serverless time limit.
 *
 * Resumable: each batch re-selects whatever is still missing, so interrupting
 * and re-running is always safe. Prints what it did per batch and what it
 * could not resolve (skipped URIs are left for the cron to retry).
 *
 *   npx tsx scripts/backfill-agents.ts [--slice 250] [--minutes 240] [--asc]
 */
import "dotenv/config";
import postgres from "postgres";
import { materializeSlice } from "../src/lib/materialize.ts";

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const SLICE = arg("slice", 250);
const MAX_MINUTES = arg("minutes", 720);
const ASC = process.argv.includes("--asc"); // chew the oldest backlog first instead

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }

const sql = postgres(url, { prepare: false, max: 5, connect_timeout: 25, onnotice: () => {} });

const startedAt = Date.now();
let materialized = 0, skipped = 0, burned = 0, endpoints = 0, batches = 0;

try {
  while (true) {
    const elapsedMin = (Date.now() - startedAt) / 60_000;
    if (elapsedMin >= MAX_MINUTES) {
      console.log(`\ntime cap reached (${MAX_MINUTES} min) — re-run to continue`);
      break;
    }

    // One batch failing must not end the run: against the shared Supabase
    // pooler, statements occasionally cancel ("statement timeout") under
    // concurrent cron load. A failed batch writes nothing (statement-level
    // abort) and the next re-selects the same rows, so retrying is correct.
    let out: Awaited<ReturnType<typeof materializeSlice>> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3 && !out; attempt++) {
      try {
        out = await materializeSlice(sql, {
          slice: SLICE,
          timeBudgetMs: 100_000,
          concurrency: 12,
          order: ASC ? "asc" : "desc",
        });
      } catch (e) {
        lastErr = e;
        console.log(`batch failed (attempt ${attempt}): ${String((e as any)?.message ?? e).slice(0, 140)}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 20_000));
      }
    }
    if (!out) {
      console.error(`\nthree consecutive batch failures, giving up: ${String((lastErr as any)?.message ?? lastErr)}`);
      process.exitCode = 1;
      break;
    }
    batches++;
    materialized += out.materialized;
    skipped += out.skippedUnresolvable;
    burned += out.burned;
    endpoints += out.endpointsAdded;

    const rate = out.ms ? Math.round((out.materialized / out.ms) * 60000) : 0;
    console.log(
      `batch ${String(batches).padStart(3)}: materialized=${out.materialized} skipped=${out.skippedUnresolvable} ` +
      `burned=${out.burned} endpoints=${out.endpointsAdded} remaining=${out.remaining.toLocaleString()} ` +
      `(${out.ms} ms, ~${rate}/min)`,
    );

    if (out.candidates === 0 || out.remaining === 0) {
      console.log("\nbacklog clear: every resolved+named census row has an agents row");
      break;
    }
    // Give the shared RPC hosts and the pooler a breath between batches.
    await new Promise((r) => setTimeout(r, 2000));
  }

  const [state] = await sql<{ n: number; max: string }[]>`
    select count(*)::int as n, max(token_id)::text as max from agents where chain_id = 56`;
  console.log(`\nagents table now: ${(state?.n ?? 0).toLocaleString()} rows, max token #${state?.max ?? "?"}`);
  console.log(
    `this run: ${materialized.toLocaleString()} materialized, ${endpoints.toLocaleString()} endpoints added, ` +
    `${skipped.toLocaleString()} unresolvable (left for cron retry), ${burned} burned since census`,
  );
} catch (e: any) {
  console.error(`\nBACKFILL FAILED: ${String(e?.message ?? e).slice(0, 400)}`);
  if (e?.detail) console.error(`detail: ${String(e.detail).slice(0, 200)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
