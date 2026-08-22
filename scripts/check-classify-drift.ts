/**
 * Has classification drifted behind ingestion, or behind the rules?
 *
 * Capability text arrives continuously from the probe and resolve jobs. Before
 * classification was scheduled, that text piled up unread and newly discovered
 * agents stayed invisible to category browsing. This reports the gap.
 *
 * It reports TWO gaps, because conflating them was itself the bug. An agent with
 * capability text that matches no rule is not a backlog item - it has been
 * examined and the answer was "none of the above". Counting it as outstanding work
 * described a queue that could never empty, and the old classifier acted on that
 * reading: it re-examined those rows every ten minutes forever.
 *
 *   queued       not yet examined by the rules currently in force, or the agent
 *                card was refetched since. Real work. Drains to zero.
 *   unclassified examined by these exact rules and matched nothing. A finding
 *                about the corpus, expected to be large, and not work.
 *
 * A third figure matters when the taxonomy changes: editing any rule changes the
 * fingerprint, so every agent re-enters `queued` automatically.
 */
import "dotenv/config";
import postgres from "postgres";
import { RULES_FINGERPRINT } from "../src/lib/classify.ts";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

const rows = await sql<any[]>`
  select
    count(*)::int                                                        as agents,
    count(*) filter (where classified_at is not null)::int                as ever_classified,
    count(*) filter (where classify_rules = ${RULES_FINGERPRINT})::int    as current_rules,
    count(*) filter (where card_fetched_at is not null)::int              as cards_seen,

    -- Real work: never examined, examined under superseded rules, or the card
    -- changed since. Text is required, since there is nothing to read without it.
    count(*) filter (
      where (name is not null or description is not null or skills is not null)
        and (
          classify_rules is distinct from ${RULES_FINGERPRINT}
          or (card_fetched_at is not null and card_fetched_at > coalesce(classified_at, 'epoch'::timestamptz))
        )
    )::int                                                               as queued,

    -- Examined by these rules, matched nothing. A finding, not a queue.
    count(*) filter (
      where category is null and classify_rules = ${RULES_FINGERPRINT}
    )::int                                                               as unclassified,

    -- Of those, the ones carrying the strongest evidence we have. If this is
    -- large, the rules are missing something the corpus plainly states.
    count(*) filter (
      where category is null and classify_rules = ${RULES_FINGERPRINT} and skills is not null
    )::int                                                               as unmatched_with_skills
  from agents where chain_id = 56
`;
const r = rows[0] ?? {};
const n = (v: unknown) => Number(v ?? 0).toLocaleString();

console.log(`\n  CLASSIFICATION COVERAGE          rules ${RULES_FINGERPRINT}`);
console.log(`    agents                    ${n(r.agents)}`);
console.log(`    ever classified           ${n(r.ever_classified)}`);
console.log(`    under CURRENT rules       ${n(r.current_rules)}`);
console.log(`    agent cards captured      ${n(r.cards_seen)}`);

console.log(`\n  WORK OUTSTANDING`);
console.log(`    queued                    ${n(r.queued)}   <- drains to zero`);

console.log(`\n  FINDINGS (not work)`);
console.log(`    matched no rule           ${n(r.unclassified)}`);
console.log(`    ...of those, with skills  ${n(r.unmatched_with_skills)}   <- rules may be missing a capability`);

const queued = Number(r.queued ?? 0);
console.log(
  queued === 0
    ? `\n  No backlog: every agent with capability text has been examined by the current rules.`
    : `\n  ${n(queued)} agent(s) awaiting the scheduled classifier (gebo-classify, every 10 min).`,
);

const unmatched = Number(r.unmatched_with_skills ?? 0);
if (unmatched > 0) {
  console.log(
    `  ${n(unmatched)} agent(s) publish skills that match no rule. Run` +
    `\n  scripts/emerging-categories.ts to see whether a capability is missing.`,
  );
}
console.log("");

await sql.end({ timeout: 5 });
