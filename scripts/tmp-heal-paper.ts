/**
 * Heal paper_decisions.inputs: 110 rows (runs 1 and 2) were written with a
 * pre-stringified value cast to jsonb, which double-encodes (jsonb_typeof =
 * 'string'), so the scorer's key reads all returned null and no decision was
 * ever scored. Unwrap ONLY rows whose inputs is a json string, guarded by
 * jsonb_typeof = 'string' (invariant 10: never assume the scalar's contents),
 * and re-run the scoring pass so the record is honest.
 *
 * One-off, 2026-09-08. npx tsx scripts/tmp-heal-paper.ts
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 });

async function main() {
  const before = await sql`
    select jsonb_typeof(inputs) as kind, count(*)::int as n
    from paper_decisions group by 1`;
  console.log("before:", before);

  const healed = await sql`
    update paper_decisions
    set inputs = (inputs #>> '{}')::jsonb
    where jsonb_typeof(inputs) = 'string'
      and jsonb_typeof((inputs #>> '{}')::jsonb) = 'object'`;
  console.log("rows unwrapped:", healed.count);

  const after = await sql`
    select jsonb_typeof(inputs) as kind, count(*)::int as n
    from paper_decisions group by 1`;
  console.log("after:", after);

  const sample = await sql`
    select run_id, inputs ->> 'utilisation' as util
    from paper_decisions order by id limit 3`;
  for (const s of sample) console.log(`run ${s.run_id} utilisation=${s.util}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
