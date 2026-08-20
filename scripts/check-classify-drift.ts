/**
 * Has classification drifted behind ingestion?
 *
 * Capability text arrives continuously from the probe and resolve jobs. Before
 * classification was scheduled, that text piled up unread and newly discovered
 * agents stayed invisible to category browsing. This reports the gap.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

const rows = await sql<any[]>`
  select
    count(*)::int                                                        as agents,
    count(*) filter (where category is null)::int                         as unclassified,
    count(*) filter (where category is null and skills is not null)::int  as unclassified_with_skills,
    count(*) filter (where card_fetched_at is not null)::int              as cards_seen,
    count(*) filter (where classified_at is not null)::int                as ever_classified,
    count(*) filter (
      where card_fetched_at is not null
        and card_fetched_at > coalesce(classified_at, 'epoch'::timestamptz)
    )::int                                                               as stale
  from agents where chain_id = 56
`;
const r = rows[0] ?? {};
const n = (v: unknown) => Number(v ?? 0).toLocaleString();

console.log(`\n  CLASSIFICATION COVERAGE`);
console.log(`    agents                    ${n(r.agents)}`);
console.log(`    ever classified           ${n(r.ever_classified)}`);
console.log(`    unclassified              ${n(r.unclassified)}`);
console.log(`    unclassified WITH skills  ${n(r.unclassified_with_skills)}   <- classifiable now`);
console.log(`    agent cards captured      ${n(r.cards_seen)}`);
console.log(`    card newer than category  ${n(r.stale)}   <- due for reclassification`);

const backlog = Number(r.unclassified_with_skills ?? 0) + Number(r.stale ?? 0);
console.log(
  backlog === 0
    ? `\n  No backlog: every agent with capability text has a current classification.\n`
    : `\n  ${n(backlog)} agent(s) awaiting the scheduled classifier (gebo-classify, every 10 min).\n`,
);

await sql.end({ timeout: 5 });
