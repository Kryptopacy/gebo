import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });

async function main() {
  try {
    for (let i = 1; i <= 3; i++) {
      const t = Date.now();
      await sql`select count(*)::int from agents where chain_id = 56 and category is null`;
      console.log(`agents null-category count: ${Date.now() - t}ms`);
    }
    const act = await sql`
      select state, wait_event_type, count(*)::int as n,
             max(now() - query_start)::text as oldest, left(query, 70) as q
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'
      group by 1, 2, left(query, 70) order by n desc limit 8`;
    console.log(`\nnon-idle activity:`);
    for (const a of act) console.log(`  ${String(a.state).padEnd(8)} n=${a.n} wait=${a.wait_event_type ?? "-"} oldest=${a.oldest ?? "-"}  ${a.q}`);

    const [sz] = await sql<{ s: string }[]>`select pg_size_pretty(pg_database_size(current_database())) as s`;
    console.log(`\ndb size: ${sz?.s}`);

    const [{ site }] = await sql<{ site: string }[]>`
      select public.gebo_secret('gebo_site_url') as site`;
    const t2 = Date.now();
    const r = await fetch(site, { cache: "no-store" });
    const html = await r.text();
    console.log(`landing: ${r.status} in ${Date.now() - t2}ms  banner=${/could not be measured/i.test(html)}`);
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
