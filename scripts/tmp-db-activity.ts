/** What is saturating the database right now? Read-only. */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 30, onnotice: () => {} });

try {
  const act = await sql<{ pid: number; state: string; wait: string | null; dur: string; q: string }[]>`
    select pid, state,
           wait_event_type || '/' || coalesce(wait_event, '-') as wait,
           now() - query_start as dur,
           left(query, 70) as q
    from pg_stat_activity
    where state <> 'idle' and pid <> pg_backend_pid()
    order by query_start limit 12`;
  for (const a of act) console.log(`${a.pid} ${a.state} ${a.wait} ${a.dur} :: ${a.q}`);
  if (!act.length) console.log("(no non-idle backends)");

  const locks = await sql<{ pid: number; rel: string | null; dur: string }[]>`
    select l.pid, coalesce(r.relname, '?') as rel, now() - a.query_start as dur
    from pg_locks l
    left join pg_class r on r.oid = l.relation
    join pg_stat_activity a on a.pid = l.pid
    where not l.granted limit 10`;
  console.log(locks.length ? `waiting locks: ${locks.length}` : "no waiting locks");
  for (const l of locks) console.log(`  ${l.pid} waits on ${l.rel} (${l.dur})`);
} catch (e: any) {
  console.log(`err: ${e.message}`);
} finally {
  await sql.end({ timeout: 5 });
}
