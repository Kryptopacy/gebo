/**
 * Size the resolved-but-URI-less population: registry rows marked resolved
 * with no token_uri can never be materialized by resolving a URI, so how
 * they got there decides the fix. Read-only.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [a] = await sql<{ n: number }[]>`
    select count(*)::int as n from registry_tokens
    where resolved and has_name and token_uri is null`;
  const [b] = await sql<{ n: number }[]>`
    select count(*)::int as n from registry_tokens
    where resolved and has_name and token_uri is not null
      and not exists (select 1 from agents x where x.chain_id = 56 and x.token_id = registry_tokens.token_id)`;
  const [c] = await sql<{ n: number; max: string; min: string }[]>`
    select count(*)::int as n, min(token_id)::text as min, max(token_id)::text as max
    from registry_tokens where resolved and has_name and token_uri is null`;
  const schemes = await sql<{ uri_scheme: string | null; n: number }[]>`
    select uri_scheme, count(*)::int as n from registry_tokens
    where resolved and has_name and token_uri is null group by uri_scheme`;
  console.log(`resolved+named with NO token_uri:        ${(a?.n ?? 0).toLocaleString()} (token range #${c?.min ?? "?"} - #${c?.max ?? "?"})`);
  console.log(`resolved+named with URI, not in agents:  ${(b?.n ?? 0).toLocaleString()}`);
  console.log(`schemes of the URI-less: ${schemes.map((s) => `${s.uri_scheme ?? "null"}=${s.n}`).join(", ")}`);
} catch (e: any) {
  console.error(`query failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
