/**
 * Admin session auth for the ops dashboard (/admin).
 *
 * Single-admin by design: the email allowlist is fixed in source (it is not
 * a secret - the gate is the password), ADMIN_PASSWORD comes from the
 * environment, and the session cookie is an HMAC over the expiry signed with
 * ADMIN_SESSION_SECRET falling back to CRON_SECRET, so deployments need no
 * new secret to issue sessions.
 *
 * Failure modes mirror cron-auth: when ADMIN_PASSWORD is unset, login
 * refuses rather than defaulting open, and comparisons are constant-time.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_EMAIL = "kryptopacy@gmail.com";
export const ADMIN_COOKIE = "gebo_admin";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

function sessionKey(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.CRON_SECRET || "";
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

/** Constant-time string comparison; length is not secret here (both hex). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function adminPasswordConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

/** Constant-time password check (length-first, like cron-auth). */
export function passwordMatches(provided: string): boolean {
  const secret = process.env.ADMIN_PASSWORD ?? "";
  if (!secret) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createSessionToken(now = Date.now()): string | null {
  const key = sessionKey();
  if (!key) return null;
  const exp = now + SESSION_TTL_MS;
  return `${exp}.${sign(String(exp), key)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const key = sessionKey();
  if (!key) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) <= now) return false;
  return safeEqual(sig, sign(exp, key));
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
