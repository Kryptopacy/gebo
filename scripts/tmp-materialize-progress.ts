/** Read-only: is the every-minute cron actually materializing? */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [r] = await sql<{ remaining: number; agents: number; agents_max: string; census_max: string }[]>`
    select
      (select count(*)::int from registry_tokens r
        where r.resolved = true and r.has_name = true
          and (r.token_uri is not null or r.uri_scheme in ('data','https','http','ipfs'))
          and not exists (select 1 from agents a where a.chain_id = 56 and a.token_id = r.token_id)) as remaining,
      (select count(*)::int from agents where chain_id = 56) as agents,
      (select max(token_id)::text from agents where chain_id = 56) as agents_max,
      (select max(token_id)::text from registry_tokens) as census_max`;
  console.log(`agents: ${r?.agents.toLocaleString()} | census max #${r?.census_max} vs agents max #${r?.agents_max} | backlog remaining: ${r?.remaining.toLocaleString()}`);
} finally {
  await sql.end({ timeout: 5 });
}
