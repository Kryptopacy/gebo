/**
 * Size the bloat: what exactly makes materialized agent rows heavy, and what
 * reclaiming those columns would save. Read-only.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [a] = await sql<{ n: number; with_json: number; avg_json: number; avg_uri: number; uri_over_500: number; uri_bytes: number }[]>`
    select count(*)::int as n,
      count(registration_json)::int as with_json,
      coalesce(avg(length(registration_json::text)), 0)::int as avg_json,
      coalesce(avg(length(coalesce(token_uri, ''))), 0)::int as avg_uri,
      count(*) filter (where length(coalesce(token_uri, '')) > 500)::int as uri_over_500,
      coalesce(sum(length(coalesce(token_uri, ''))), 0)::bigint as uri_bytes
    from agents where chain_id = 56`;
  console.log(`agents: ${a?.n.toLocaleString()} rows`);
  console.log(`  registration_json present: ${a?.with_json.toLocaleString()} (avg ${a?.avg_json} chars)`);
  console.log(`  token_uri avg ${a?.avg_uri} chars, ${a?.uri_over_500.toLocaleString()} rows over 500, total ${(Number(a?.uri_bytes ?? 0) / 1e6).toFixed(1)} MB of URI text`);

  const [r] = await sql<{ n: number; with_uri: number; avg_len: number; total_mb: number }[]>`
    select count(*)::int as n,
      count(token_uri)::int as with_uri,
      coalesce(avg(length(coalesce(token_uri, ''))), 0)::int as avg_len,
      coalesce(sum(length(coalesce(token_uri, ''))), 0) / 1e6 as total_mb
    from registry_tokens`;
  console.log(`registry_tokens: ${r?.n.toLocaleString()} rows, ${r?.with_uri.toLocaleString()} with URI (avg ${r?.avg_len} chars, ${r?.total_mb?.toFixed?.(1)} MB total URI text)`);

  const [pr] = await sql<{ oldest: string | null; newest: string | null; per_day: number }[]>`
    select min(at)::text as oldest, max(at)::text as newest,
      (count(*) / 18.0)::int as per_day
    from probes_raw`;
  console.log(`probes_raw: oldest ${pr?.oldest?.slice(0, 19)} newest ${pr?.newest?.slice(0, 19)} (~${pr?.per_day}/day over span)`);
} catch (e: any) {
  console.error(`query failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
