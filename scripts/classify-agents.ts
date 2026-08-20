/**
 * Apply capability classification across the indexed agents.
 *
 * Runs the classifier from src/lib/classify.ts over name, description and A2A
 * card skills, and records both the category and the evidence that produced it.
 *
 * Prints the distribution afterwards, because the expected result is that the
 * four judged categories stay small. That is the measured reality of BNB Chain,
 * not a defect in the rules, and the product reports it rather than padding it.
 */
import "dotenv/config";
import postgres from "postgres";
import { classifyCapability, CATEGORY_LABEL, isJudged, type AnyCategory } from "../src/lib/classify.ts";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 4, onnotice: () => {} });

type Row = {
  token_id: string;
  name: string | null;
  description: string | null;
  skills: string[] | null;
};

try {
  const rows = await sql<Row[]>`
    select token_id::text as token_id, name, description, skills
    from agents where chain_id = 56
  `;
  console.log(`\n  classifying ${rows.length.toLocaleString()} agents`);

  let assigned = 0;
  let judged = 0;
  const dist = new Map<string, number>();
  const bySource = new Map<string, number>();
  let batch: { token_id: string; category: string | null; matched: string[] | null; conf: number }[] = [];

  async function flush() {
    if (!batch.length) return;
    /**
     * Sent as jsonb rather than parallel arrays. An earlier version used
     * unnest(text[][]) for the evidence column, which flattens a 2-D array and
     * fails with "is of type text[] but expression is of type text" - Postgres
     * has no ragged array-of-arrays to unnest into one row each.
     */
    const payload = batch.map((b) => ({
      token_id: b.token_id,
      category: b.category,
      matched: b.matched,
    }));
    await sql`
      update agents a set
        category = v.category,
        category_matched = v.matched,
        updated_at = now()
      from (
        select
          (e ->> 'token_id')::bigint as token_id,
          e ->> 'category'           as category,
          case
            when e -> 'matched' is null or e -> 'matched' = 'null'::jsonb then null
            else array(select jsonb_array_elements_text(e -> 'matched'))
          end                        as matched
        from jsonb_array_elements(${sql.json(payload as any)}::jsonb) e
      ) v
      where a.chain_id = 56 and a.token_id = v.token_id
    `;
    batch = [];
  }

  for (const r of rows) {
    const c = classifyCapability({ name: r.name, description: r.description, skills: r.skills });
    if (c.category) {
      assigned++;
      if (c.judged) judged++;
      dist.set(c.category, (dist.get(c.category) ?? 0) + 1);
      if (c.source) bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
    }
    batch.push({
      token_id: r.token_id,
      category: c.category,
      matched: c.matched.length ? c.matched : null,
      conf: c.confidence,
    });
    if (batch.length >= 500) await flush();
  }
  await flush();

  console.log(`  assigned a capability   ${assigned.toLocaleString()}`);
  console.log(`  in a judged category    ${judged.toLocaleString()}`);
  console.log(`  unclassified            ${(rows.length - assigned).toLocaleString()}`);

  console.log(`\n  DISTRIBUTION`);
  for (const [cat, n] of [...dist].sort((a, b) => b[1] - a[1])) {
    const mark = isJudged(cat) ? "JUDGED  " : "adjacent";
    console.log(`    ${mark}  ${String(n).padStart(6)}  ${cat.padEnd(12)} ${CATEGORY_LABEL[cat as AnyCategory]}`);
  }

  console.log(`\n  EVIDENCE SOURCE`);
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(12)} ${String(n).padStart(6)}`);
  }

  // Verified agents per judged category: what a user could actually hire today.
  console.log(`\n  VERIFIED AGENTS PER JUDGED CATEGORY`);
  const verified = await sql<any[]>`
    select category, count(*)::int as n
    from agents
    where chain_id = 56 and trust_state = 'VERIFIED'
      and category in ('rebalancing','grid','yield','health')
    group by category order by n desc
  `;
  if (!verified.length) console.log(`    none yet`);
  for (const v of verified) console.log(`    ${String(v.category).padEnd(14)} ${v.n}`);

  const examples = await sql<any[]>`
    select name, category, category_matched, trust_state
    from agents
    where chain_id = 56 and category in ('rebalancing','grid','yield','health')
    order by case trust_state when 'VERIFIED' then 0 else 1 end, token_id desc
    limit 14
  `;
  if (examples.length) {
    console.log(`\n  SAMPLE JUDGED-CATEGORY MATCHES`);
    for (const e of examples) {
      console.log(`    ${String(e.trust_state).padEnd(9)} ${String(e.category).padEnd(12)} ${String(e.name ?? "-").slice(0, 24).padEnd(26)} matched: ${(e.category_matched ?? []).join(", ").slice(0, 46)}`);
    }
  }
  console.log("");
} catch (e: any) {
  console.error(`\n  FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
  if (e?.detail) console.error(`  detail: ${String(e.detail).slice(0, 200)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 8 });
}
