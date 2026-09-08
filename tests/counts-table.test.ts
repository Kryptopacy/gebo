/**
 * registry_counts staleness gate (migration 0029).
 *
 * The counts table is the landing page's primary aggregate read, and its one
 * failure mode is age: a row that stops refreshing must never keep serving
 * as current. countsRowFresh is the boundary between "authoritative" and
 * "fall through to the direct query", so it is pinned here.
 */
import { describe, it, expect } from "vitest";
import { countsRowFresh, COUNTS_STALE_MS } from "../src/lib/data.ts";

describe("countsRowFresh (registry_counts staleness)", () => {
  it("accepts a row computed now", () => {
    expect(countsRowFresh(new Date().toISOString())).toBe(true);
  });

  it("accepts a row inside the 45-minute window", () => {
    expect(countsRowFresh(new Date(Date.now() - COUNTS_STALE_MS + 60_000))).toBe(true);
  });

  it("rejects a row past the window - three missed cron runs is stale, not current", () => {
    expect(countsRowFresh(new Date(Date.now() - COUNTS_STALE_MS - 1_000).toISOString())).toBe(false);
  });

  it("rejects an unparseable timestamp rather than treating it as fresh", () => {
    expect(countsRowFresh("not-a-date")).toBe(false);
  });

  it("accepts Date objects as well as ISO strings", () => {
    expect(countsRowFresh(new Date(Date.now() - 60_000))).toBe(true);
  });
});
