/**
 * Admin-triggered manual cron run. Calls this deployment's own cron route
 * with the server-held CRON_SECRET - exactly what pg_net does on schedule,
 * on demand. The admin session is the only gate; the response relays the
 * route's JSON but never the bearer token.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOBS = [
  "materialize", "sync", "resolve", "probe", "classify",
  "opportunities", "emerging", "grid-record", "regrant",
] as const;

export async function POST(request: Request) {
  const jar = await cookies();
  if (!verifySessionToken(jar.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not set" }, { status: 503 });
  }

  let job = "";
  try {
    job = String((await request.json())?.job ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  if (!(JOBS as readonly string[]).includes(job)) {
    return NextResponse.json({ ok: false, error: `unknown job (allowed: ${JOBS.join(", ")})` }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  try {
    const res = await fetch(`${origin}/api/cron/${job}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(55_000),
    });
    const text = (await res.text()).slice(0, 4000);
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep as text */ }
    return NextResponse.json({ ok: res.ok, status: res.status, job, body });
  } catch (e: any) {
    return NextResponse.json({ ok: false, job, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
