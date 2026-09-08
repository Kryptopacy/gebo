/** Is the throttle pooler-wide or database-wide? Test both modes, trivial query. */
import "dotenv/config";
import postgres from "postgres";

const txUrl = process.env.DATABASE_URL!;
const sessionUrl = txUrl.includes(":6543") ? txUrl.replace(":6543", ":5432") : txUrl;

async function probe(label: string, url: string) {
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
  try {
    let t = Date.now();
    await sql`select 1`;
    console.log(`${label}: select 1 -> ${Date.now() - t}ms`);
    t = Date.now();
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from agents where chain_id = 56 and category is null`;
    console.log(`${label}: null-category count = ${r?.n} -> ${Date.now() - t}ms`);
  } catch (e: any) {
    console.log(`${label}: FAILED after ${Date.now() - Date.now()}ms - ${String(e?.message ?? e).slice(0, 120)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await probe("transaction pooler (6543)", txUrl);
await probe("session pooler (5432)", sessionUrl);
