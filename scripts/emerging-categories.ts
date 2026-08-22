/**
 * Emerging-capability report.
 *
 * Thin wrapper: the detection logic lives in src/lib/emerging.ts so the scheduled
 * job at /api/cron/emerging and this script cannot disagree. It previously held its
 * own copy of the rule vocabulary in a hand-maintained list, which meant adding a
 * rule here without editing that list left the detector nominating the very
 * capability just implemented.
 *
 * Reads only. Persistence belongs to the cron route; this is for looking.
 *
 * Run: npx tsx scripts/emerging-categories.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { detectEmerging, warrantsReview, type EmergingInput } from "../src/lib/emerging.ts";
import { RULES_FINGERPRINT } from "../src/lib/classify.ts";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });

try {
  const rows = await sql<any[]>`
    select a.name, a.description, a.skills, a.trust_state, a.operator_key,
           o.registrable_domain as operator_domain
    from agents a
    left join operators o on o.key = a.operator_key
    where a.chain_id = 56
      and a.category is null
      and a.skills is not null
  `;

  const [totals] = await sql<{ unclassified: number; with_skills: number }[]>`
    select
      count(*) filter (where category is null)::int                          as unclassified,
      count(*) filter (where category is null and skills is not null)::int   as with_skills
    from agents where chain_id = 56
  `;

  const input: EmergingInput[] = rows.map((r) => ({
    name: r.name,
    description: r.description,
    skills: r.skills,
    trustState: r.trust_state,
    operatorDomain: r.operator_domain,
    operatorKey: r.operator_key,
  }));

  const result = detectEmerging(input);

  console.log(`\n  UNCLASSIFIED AGENTS                    rules ${RULES_FINGERPRINT}`);
  console.log(`    matched no rule           ${Number(totals?.unclassified ?? 0).toLocaleString()}`);
  console.log(`    of those, declare skills  ${Number(totals?.with_skills ?? 0).toLocaleString()}   <- the only nominating evidence`);
  console.log(`    skills echo title only    ${result.titleOnly.toLocaleString()}   <- registrations, no capability declared`);
  console.log(`    distinct skills texts     ${result.distinctTexts.toLocaleString()}  (duplicates collapsed)`);

  if (!result.examined) {
    console.log(`\n  No unclassified agent declares a skill, so there is no evidence of a`);
    console.log(`  missing category. Names and descriptions are not counted: branding lives`);
    console.log(`  there, and it produced every false candidate this detector has seen.\n`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  console.log(`\n  CANDIDATE TERMS NOT COVERED BY ANY RULE`);
  console.log(`  ${"term".padEnd(22)} ${"texts".padStart(6)} ${"verified".padStart(9)} ${"operators".padStart(10)}  examples`);
  if (!result.candidates.length) {
    console.log(`    none: no term appears in three or more DISTINCT skills texts`);
    console.log(`    from at least two independent operators`);
  }
  for (const c of result.candidates) {
    console.log(
      `  ${c.term.slice(0, 21).padEnd(22)} ${String(c.distinctTexts).padStart(6)} ` +
      `${String(c.verifiedTexts).padStart(9)} ${String(c.distinctOperators).padStart(10)}  ` +
      `${c.examples.join(", ").slice(0, 40)}`,
    );
  }

  const strong = result.candidates.filter(warrantsReview);
  console.log(`\n  ASSESSMENT`);
  if (!strong.length) {
    console.log(`    No term clears the bar: three or more distinct skills texts, from`);
    console.log(`    verified agents, spanning at least two independent operators. There is`);
    console.log(`    no evidence of a missing category - agents that match no rule are`);
    console.log(`    listings without usable capability text, not an unmet need.`);
  } else {
    console.log(`    ${strong.length} term(s) clear the bar. Candidates for a new ADJACENT rule set -`);
    console.log(`    the judged four are fixed by the rubric and never grow. Read the agents`);
    console.log(`    behind a term before adding it; frequency alone nominates brand names.`);
    for (const c of strong.slice(0, 6)) {
      console.log(
        `      ${c.term.padEnd(20)} ${c.distinctTexts} texts, ${c.verifiedTexts} verified, ` +
        `${c.distinctOperators} operators  e.g. ${c.examples[0] ?? "-"}`,
      );
    }
  }

  if (result.suppressed.length) {
    const byReason = new Map<string, number>();
    for (const s of result.suppressed) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    console.log(`\n  SUPPRESSED TERMS  (filtering is auditable, not hidden)`);
    for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${reason}`);
    }
  }
  console.log("");
} catch (e: any) {
  console.error(`\n  FAILED: ${String(e?.message ?? e).slice(0, 240)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
