import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
const rows = await sql`
  select name, category, category_matched, description, skills
  from agents where chain_id = 56 and name in ('HealthGuard','YieldRouter','RangeKeeper','Health Factor Monitor')
  order by name`;
for (const r of rows) {
  console.log(`\n  ${r.name}  ->  ${r.category}  (matched: ${(r.category_matched ?? []).join(", ")})`);
  if (r.description) console.log(`    desc:   ${String(r.description).replace(/\s+/g, " ").slice(0, 160)}`);
  for (const s of (r.skills ?? []).slice(0, 6)) console.log(`    skill:  ${String(s).slice(0, 150)}`);
}
await sql.end();
