import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
const rows = await sql`
  select category,
         count(*)::int as total,
         count(*) filter (where trust_state = 'VERIFIED')::int as verified
  from agents where chain_id = 56 and category is not null
  group by category order by total desc`;
const judged = ["rebalancing","grid","yield","health"];
let jt = 0, ot = 0;
for (const r of rows) {
  const tag = judged.includes(r.category) ? "REQUIRED" : "also    ";
  if (judged.includes(r.category)) jt += r.total; else ot += r.total;
  console.log(`  ${tag}  ${String(r.category).padEnd(13)} ${String(r.total).padStart(4)} agents, ${r.verified} verified`);
}
console.log(`\n  required four: ${jt}   other categories: ${ot}   total classified: ${jt + ot}`);
await sql.end();
