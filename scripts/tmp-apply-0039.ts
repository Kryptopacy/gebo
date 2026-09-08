/** Apply 0039 (admin pause store + guard coordination) and smoke-test the pieces. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });

async function main() {
  try {
    await sql.unsafe(readFileSync("supabase/migrations/0039_admin_cron_control.sql", "utf8"));
    console.log("0039 applied: admin_paused_jobs + guard respects admin pauses");

    // Smoke: pause a harmless job (gebo-emerging, daily at 03:17 - not due
    // before the resume), verify the definition is captured, resume it,
    // verify the schedule round-trips exactly.
    const [def] = await sql<{ schedule: string; command: string }[]>`
      select schedule, command from cron.job where jobname = 'gebo-emerging'`;
    await sql`
      insert into admin_paused_jobs (jobname, schedule, command)
      values ('gebo-emerging', ${def!.schedule}, ${def!.command})
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command`;
    await sql`select cron.unschedule('gebo-emerging')`;
    const [gone] = await sql<{ n: number }[]>`
      select count(*)::int as n from cron.job where jobname = 'gebo-emerging'`;
    console.log(`paused gebo-emerging: still scheduled = ${gone?.n === 1}`);

    const [saved] = await sql<{ schedule: string; command: string }[]>`
      select schedule, command from admin_paused_jobs where jobname = 'gebo-emerging'`;
    await sql.unsafe(
      `select cron.schedule('gebo-emerging', '${saved!.schedule.replace(/'/g, "''")}', '${saved!.command.replace(/'/g, "''")}')`,
    );
    await sql`delete from admin_paused_jobs where jobname = 'gebo-emerging'`;
    const [back] = await sql<{ schedule: string }[]>`
      select schedule from cron.job where jobname = 'gebo-emerging'`;
    console.log(`resumed gebo-emerging: [${back?.schedule}] round-trip ${back?.schedule === def!.schedule ? "EXACT" : "MISMATCH"}`);
  } catch (e: any) {
    console.error(`FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
