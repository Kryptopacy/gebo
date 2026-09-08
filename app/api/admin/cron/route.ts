/**
 * Admin cron control: run-now, pause, and resume for the scheduled fleet.
 *
 * Run-now mirrors /api/admin/trigger for HTTP jobs and extends it to the
 * direct-SQL jobs (counts, maint, guard) by executing their SQL functions
 * directly - the same statements pg_cron runs. Pause captures the job's
 * full definition from cron.job into admin_paused_jobs (schedule and
 * command come from the database, never the request) before unscheduling,
 * so resume is exact and nothing can be injected through the job name.
 *
 * The admin session is the only gate, exactly like the trigger route; the
 * fleet guard respects admin pauses (0039), so a deliberate pause is not
 * silently undone by the auto-restore.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import postgres from "postgres";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** HTTP cron routes runnable on demand (same shape as /api/admin/trigger). */
const HTTP_JOBS = [
  "materialize", "sync", "resolve", "probe", "classify",
  "opportunities", "emerging", "grid-record", "regrant",
  "sessions", "paper", "reputation",
] as const;

/** Direct-SQL jobs: run-now executes the exact function the schedule runs. */
const SQL_JOBS: Record<string, string> = {
  counts: "select public.refresh_registry_counts()",
  maint: "select public.gebo_maintain()",
  guard: "select public.gebo_fleet_guard()",
};

type Action = "run" | "pause" | "resume";

export async function POST(request: Request) {
  const jar = await cookies();
  if (!verifySessionToken(jar.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let action = "";
  let job = "";
  try {
    const body = await request.json();
    action = String(body?.action ?? "");
    job = String(body?.job ?? "").replace(/^gebo-/, "");
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  if (!["run", "pause", "resume"].includes(action)) {
    return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });
  const sql = postgres(dbUrl, { prepare: false, max: 1, connect_timeout: 10, onnotice: () => {} });

  try {
    if (action === "run") {
      if (job in SQL_JOBS) {
        const rows = await sql.unsafe(`${SQL_JOBS[job]} `).then((r) => r as unknown as Record<string, unknown>[]);
        return NextResponse.json({ ok: true, job, kind: "sql", body: rows?.[0] ?? null });
      }
      if (!(HTTP_JOBS as readonly string[]).includes(job)) {
        return NextResponse.json({ ok: false, error: `unknown job: ${job}` }, { status: 400 });
      }
      const secret = process.env.CRON_SECRET;
      if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET not set" }, { status: 503 });
      const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
      const res = await fetch(`${origin}/api/cron/${job}`, {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(55_000),
      });
      const text = (await res.text()).slice(0, 4000);
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep as text */ }
      return NextResponse.json({ ok: res.ok, status: res.status, job, kind: "http", body });
    }

    const fullJob = `gebo-${job}`;

    if (action === "pause") {
      const [def] = await sql<{ schedule: string; command: string }[]>`
        select schedule, command from cron.job where jobname = ${fullJob}`;
      if (!def) {
        return NextResponse.json({ ok: false, error: `${fullJob} is not scheduled (already paused or unknown)` }, { status: 404 });
      }
      await sql`
        insert into admin_paused_jobs (jobname, schedule, command)
        values (${fullJob}, ${def.schedule}, ${def.command})
        on conflict (jobname) do update set
          schedule = excluded.schedule, command = excluded.command, paused_at = now()`;
      await sql`select cron.unschedule(${fullJob})`;
      return NextResponse.json({ ok: true, job: fullJob, action: "paused", schedule: def.schedule });
    }

    if (action === "resume") {
      const [def] = await sql<{ schedule: string; command: string }[]>`
        select schedule, command from admin_paused_jobs where jobname = ${fullJob}`;
      if (!def) {
        return NextResponse.json({ ok: false, error: `${fullJob} is not paused` }, { status: 404 });
      }
      // schedule is an upsert on jobname: safe even if something re-created it
      await sql.unsafe(
        `select cron.schedule('${fullJob.replace(/'/g, "''")}', ` +
        `'${def.schedule.replace(/'/g, "''")}', ` +
        `'${def.command.replace(/'/g, "''")}')`,
      );
      await sql`delete from admin_paused_jobs where jobname = ${fullJob}`;
      return NextResponse.json({ ok: true, job: fullJob, action: "resumed", schedule: def.schedule });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, job, error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
