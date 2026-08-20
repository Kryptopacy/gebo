/**
 * Read the persisted census statistics.
 *
 * Kept in a dedicated module so `scripts/` can import it without dragging in
 * the whole data layer, and so the fallback lives in exactly one place.
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { prepare: false, max: 1, onnotice: () => {} }) : null;

if (!sql) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const [r] = await sql<any[]>`
  select tokens_minted, censused, resolved, named, claim_active, with_endpoint,
         callable, operators, owners, owners_with_one_agent,
         largest_operator_share, top5_operator_share, top10_owner_share,
         declares_reputation, empty_token_uri, x402_supported, fatal_defects,
         uri_schemes, endpoint_kinds, top_operators, measured_at
  from census_stats where id = 'bsc'
`;

if (!r) {
  console.log("\n  no census_stats row — run: npx tsx scripts/analyse-census.ts\n");
} else {
  const n = (v: any) => (v == null ? "—" : Number(v).toLocaleString());
  console.log("\n  census_stats (what the app now serves)");
  console.log("  " + "-".repeat(56));
  console.log(`  tokens minted         ${n(r.tokens_minted)}`);
  console.log(`  censused              ${n(r.censused)}`);
  console.log(`  resolved              ${n(r.resolved)}`);
  console.log(`  claim active          ${n(r.claim_active)}`);
  console.log(`  declare an endpoint   ${n(r.with_endpoint)}`);
  console.log(`  callable              ${n(r.callable)}`);
  console.log(`  operators             ${n(r.operators)}`);
  console.log(`  owners                ${n(r.owners)}`);
  console.log(`  owners with 1 agent   ${n(r.owners_with_one_agent)}`);
  console.log(`  largest operator      ${r.largest_operator_share}%`);
  console.log(`  measured at           ${new Date(r.measured_at).toISOString()}`);
  console.log(`  uri schemes           ${JSON.stringify(r.uri_schemes)}`);
  console.log(`  endpoint kinds        ${JSON.stringify(r.endpoint_kinds)}`);
  console.log("");
}

await sql.end({ timeout: 5 });
