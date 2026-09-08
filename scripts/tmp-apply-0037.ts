/** Apply 0037 (gebo-counts cadence to every 15 min) and report DB health. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });

async function ping(): Promise<number> {
  const t = Date.now();
  await sql`select 1`;
  return Date.now() - t;
}

async function main() {
  console.log(`ping before: ${await ping()}ms`);
  await sql.unsafe(readFileSync("supabase/migrations/0037_cron_cadence.sql", "utf8"));
  const [job] = await sql<{ schedule: string; active: boolean }[]>`
    select schedule, active from cron.job where jobname = 'gebo-counts'`;
  console.log(`gebo-counts rescheduled: [${job?.schedule}] active=${job?.active}`);

  // overnight paper run?
  const runs = await sql<{ id: number; decisions_n: number; started_at: string }[]>`
    select id, decisions_n, started_at::text from paper_runs order by id desc limit 3`;
  console.log(`paper runs: ${runs.map((r) => `#${r.id} (${r.decisions_n} decisions, ${r.started_at.slice(0, 16)})`).join("; ") || "none"}`);
  const [dec] = await sql<{ scored: number }[]>`
    select count(*)::int as scored from paper_decisions where scored_at is not null`;
  console.log(`paper decisions scored: ${dec?.scored}`);

  const [ci] = await sql<{ n: number }[]>`
    select count(*)::int as n from sessions where source = 'chain-index'`;
  console.log(`chain-index sessions: ${ci?.n}`);
  console.log(`ping after: ${await ping()}ms`);
}

main()
  .catch((e: any) => { console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`); process.exitCode = 1; })
  .finally(() => sql.end({ timeout: 5 }));
