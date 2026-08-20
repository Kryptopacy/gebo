/**
 * Look at the captured capability text before writing any classification rules.
 *
 * The point of this script is to avoid inventing keyword rules that manufacture
 * coverage. It is entirely possible that 82 of 21,278 is close to correct - that
 * very few agents on BNB Chain genuinely do LP rebalancing, grid trading, yield
 * routing or health-factor defence - and in that case the honest product answer
 * is to report the absence, not to pad the categories.
 *
 * So: measure first. What is actually in the text?
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });

const [cov] = await sql<any[]>`
  select
    count(*)::int                                          as agents,
    count(*) filter (where description is not null)::int   as with_desc,
    count(*) filter (where skills is not null)::int         as with_skills,
    count(*) filter (where card_fetched_at is not null)::int as cards,
    count(*) filter (where trust_state = 'VERIFIED')::int   as verified
  from agents where chain_id = 56
`;
console.log("\n  CAPABILITY TEXT COVERAGE");
console.log(`    agents            ${Number(cov.agents).toLocaleString()}`);
console.log(`    verified          ${Number(cov.verified).toLocaleString()}`);
console.log(`    agent card seen   ${Number(cov.cards).toLocaleString()}`);
console.log(`    has description   ${Number(cov.with_desc).toLocaleString()}`);
console.log(`    has skills        ${Number(cov.with_skills).toLocaleString()}`);

// What do the skills actually say? Frequency over individual skill entries.
const skillFreq = await sql<any[]>`
  select lower(trim(s)) as skill, count(*)::int as n
  from agents, unnest(skills) as s
  where chain_id = 56
  group by 1 order by n desc limit 40
`;
console.log(`\n  MOST COMMON SKILL ENTRIES`);
if (!skillFreq.length) console.log(`    none captured`);
for (const s of skillFreq) {
  console.log(`    ${String(s.n).padStart(5)}  ${String(s.skill).slice(0, 96)}`);
}

// Descriptions, deduplicated - mass-minted agents repeat the same text.
const descFreq = await sql<any[]>`
  select left(description, 130) as d, count(*)::int as n
  from agents where chain_id = 56 and description is not null
  group by 1 order by n desc limit 15
`;
console.log(`\n  MOST COMMON DESCRIPTIONS (first 130 chars)`);
if (!descFreq.length) console.log(`    none captured`);
for (const d of descFreq) {
  console.log(`    ${String(d.n).padStart(5)}  ${String(d.d).replace(/\s+/g, " ")}`);
}

/**
 * Does the four-category vocabulary appear at all? Counted over the combined
 * capability text so the answer is about the corpus, not about my rules.
 */
const terms = [
  "rebalanc", "liquidity", "lp", "concentrated", "range", "pancake", "pool",
  "grid", "dca", "market mak", "arbitrage", "scalp",
  "yield", "apy", "apr", "farm", "vault", "stake", "lend", "venus", "aave", "lista",
  "health factor", "liquidat", "collateral", "borrow", "debt", "ltv",
  "swap", "trade", "trading", "portfolio", "monitor", "alert", "price",
];
console.log(`\n  VOCABULARY PRESENT IN name + description + skills`);
for (const t of terms) {
  const [r] = await sql<any[]>`
    select count(*)::int as n from agents
    where chain_id = 56
      and (
        lower(coalesce(name, '')) like ${"%" + t + "%"}
        or lower(coalesce(description, '')) like ${"%" + t + "%"}
        or exists (select 1 from unnest(coalesce(skills, '{}')) x where lower(x) like ${"%" + t + "%"})
      )
  `;
  if (Number(r.n) > 0) console.log(`    ${String(r.n).padStart(6)}  ${t}`);
}

// Verified agents with real capability text - the population worth classifying.
console.log(`\n  VERIFIED AGENTS WITH CAPABILITY TEXT`);
const rich = await sql<any[]>`
  select name, left(coalesce(description, ''), 90) as d, skills
  from agents
  where chain_id = 56 and trust_state = 'VERIFIED'
    and (description is not null or skills is not null)
  order by coalesce(array_length(skills, 1), 0) desc
  limit 18
`;
if (!rich.length) console.log(`    none`);
for (const r of rich) {
  const sk = (r.skills ?? []).slice(0, 4).join(" | ").slice(0, 110);
  console.log(`    ${String(r.name ?? "-").slice(0, 26).padEnd(28)} ${sk || String(r.d).replace(/\s+/g, " ").slice(0, 80)}`);
}

await sql.end();
console.log("");
