/**
 * Admin login. Email allowlist + ADMIN_PASSWORD (constant-time), uniform
 * failure response and a deliberate delay so neither the email nor the
 * password can be probed one field at a time. Refuses to run when
 * ADMIN_PASSWORD is unset - never default open, same law as cron-auth.
 */
import { NextResponse } from "next/server";
import { ADMIN_EMAIL, ADMIN_COOKIE, passwordMatches, adminPasswordConfigured, createSessionToken, sessionCookieOptions } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const FAIL_DELAY_MS = 600;

export async function POST(request: Request) {
  if (!adminPasswordConfigured()) {
    return NextResponse.json({ ok: false, error: "ADMIN_PASSWORD is not configured" }, { status: 503 });
  }

  let email = "", password = "";
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  const emailOk = email === ADMIN_EMAIL;
  const passOk = passwordMatches(password);
  if (!emailOk || !passOk) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "no signing key available (set ADMIN_SESSION_SECRET or CRON_SECRET)" }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, sessionCookieOptions());
  return res;
}
