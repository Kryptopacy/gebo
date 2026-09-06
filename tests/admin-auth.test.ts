/**
 * Session tokens for the admin dashboard: roundtrip, expiry, tamper and
 * wrong-key rejection. Pinned because the dashboard gates every cron
 * trigger, so a token that verifies when it should not is the whole
 * security model failing quietly.
 */
import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken, passwordMatches } from "../src/lib/admin-auth.ts";

const NOW = 1_800_000_000_000;

describe("admin session tokens", () => {
  it("roundtrips with the same key and rejects when expired", () => {
    process.env.ADMIN_SESSION_SECRET = "test-key-1";
    const token = createSessionToken(NOW)!;
    expect(verifySessionToken(token, NOW + 1000)).toBe(true);
    // 7-day TTL
    expect(verifySessionToken(token, NOW + 8 * 24 * 3600 * 1000)).toBe(false);
  });

  it("rejects tampered payloads and foreign keys", () => {
    process.env.ADMIN_SESSION_SECRET = "test-key-1";
    const token = createSessionToken(NOW)!;
    const [exp, sig] = token.split(".");
    expect(verifySessionToken(`${Number(exp) + 999999}.${sig}`, NOW)).toBe(false);
    process.env.ADMIN_SESSION_SECRET = "test-key-2";
    expect(verifySessionToken(token, NOW)).toBe(false);
  });

  it("rejects malformed tokens without throwing", () => {
    process.env.ADMIN_SESSION_SECRET = "test-key-1";
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken("not-a-token")).toBe(false);
    expect(verifySessionToken("abc.def")).toBe(false);
  });

  it("never issues tokens without a signing key", () => {
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.CRON_SECRET;
    expect(createSessionToken(NOW)).toBeNull();
  });
});

describe("admin password check", () => {
  it("refuses when unset, matches only the exact password", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(passwordMatches("anything")).toBe(false);
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
    expect(passwordMatches("correct horse battery staple")).toBe(true);
    expect(passwordMatches("wrong")).toBe(false);
    expect(passwordMatches("correct horse battery stapl")).toBe(false);
  });
});
