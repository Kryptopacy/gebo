import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });

// What raw material is actually available for classification?
const [counts] = await sql<any[]>`
  select
    count(*)::int                                                as agents,
    count(*) filter (where name is not null)::int                as with_name,
    count(*) filter (where category is not null)::int            as classified,
    count(*) filter (where description is not null)::int         as with_description
  from agents where chain_id = 56
`;
console.log("\n  AGENTS TABLE");
for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(18)} ${Number(v).toLocaleString()}`);

// registration_json is where skills/description live, if we stored them.
const [reg] = await sql<any[]>`
  select count(*) filter (where registration_json is not null)::int as with_json
  from agents where chain_id = 56
`;
console.log(`    registration_json  ${Number(reg.with_json).toLocaleString()}`);

console.log("\n  SAMPLE NAMES OF UNCLASSIFIED AGENTS THAT ARE CALLABLE");
const rows = await sql<any[]>`
  select a.name, a.protocols, o.registrable_domain as operator
  from agents a left join operators o on o.key = a.operator_key
  where a.chain_id = 56 and a.category is null and a.lint_usable = true
  order by a.token_id desc limit 25
`;
for (const r of rows) {
  console.log(`    ${String(r.name ?? "(no name)").slice(0, 44).padEnd(46)} ${String(r.operator ?? "-").slice(0, 26)}`);
}

await sql.end();
