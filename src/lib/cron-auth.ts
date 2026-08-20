/**
 * Shared cron-route guard.
 *
 * These endpoints mutate data, so they must not be publicly triggerable —
 * anyone could otherwise force GEBO to hammer 20k third-party endpoints from
 * our IP. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; GitHub
 * Actions sends the same header explicitly.
 *
 * If CRON_SECRET is unset the routes refuse to run rather than defaulting open.
 */
import { NextResponse } from "next/server";

export function authorizeCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured; refusing to run" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  // Constant-time-ish comparison. Length check first avoids leaking length.
  if (provided.length !== secret.length) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  if (diff !== 0) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  return null;
}
