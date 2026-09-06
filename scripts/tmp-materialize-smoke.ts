/**
 * One-shot smoke test: materialize a single small slice and print exactly
 * what landed, so the pipeline is validated against real data before the
 * cron and backfill run at scale.
 */
import "dotenv/config";
import postgres from "postgres";
import { materializeSlice } from "../src/lib/materialize.ts";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 5, connect_timeout: 25, onnotice: () => {} });

try {
  const out = await materializeSlice(sql, { slice: 5, timeBudgetMs: 60_000 });
  console.log("summary:", JSON.stringify(out, null, 2));

  const fresh = await sql<{
    token_id: string; name: string | null; trust_state: string; trust_reason: string;
    operator_key: string | null; endpoint_count: number; lint_usable: boolean;
  }[]>`
    select a.token_id::text as token_id, a.name, a.trust_state, a.trust_reason,
           a.operator_key, a.lint_usable,
           (select count(*)::int from agent_endpoints e
             where e.chain_id = 56 and e.token_id = a.token_id) as endpoint_count
    from agents a
    where a.chain_id = 56 and a.first_seen_at > now() - interval '5 minutes'
    order by a.token_id desc limit 10`;
  console.log("\nnewest freshly-materialized rows:");
  for (const r of fresh) {
    console.log(`  #${r.token_id} "${r.name}" ${r.trust_state} eps=${r.endpoint_count} lint=${r.lint_usable} op=${r.operator_key ?? "-"} (${r.trust_reason.slice(0, 60)})`);
  }
} catch (e: any) {
  console.error(`smoke test failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
