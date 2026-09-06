/**
 * The search page's numbers must be arithmetic, not vibes: the page count,
 * the cap disclosure and the URL shape all render on a judged surface, and
 * an off-by-one in pagination is the kind of quiet fabrication this product
 * refuses to ship.
 */
import { describe, it, expect } from "vitest";
import {
  parseSearchParams, totalPages, clampPage, offsetFor, hiddenByCap,
  pageHref, stateHref, sortHref, PAGE_SIZE, MAX_PAGES,
} from "../src/lib/search-page.ts";

describe("parseSearchParams", () => {
  it("defaults to page 1, trusted sort, no filter", () => {
    expect(parseSearchParams({ q: "grid" })).toEqual({ q: "grid", page: 1, state: null, sort: "trusted" });
  });

  it("rejects unknown states and sorts, clamps junk pages and long queries", () => {
    expect(parseSearchParams({ q: "x", state: "HACKED", sort: "popular" }).state).toBeNull();
    expect(parseSearchParams({ q: "x", sort: "popular" }).sort).toBe("trusted");
    expect(parseSearchParams({ q: "x", page: "-3" }).page).toBe(1);
    expect(parseSearchParams({ q: "x", page: "banana" }).page).toBe(1);
    expect(parseSearchParams({ q: "y".repeat(400) }).q.length).toBe(200);
  });

  it("accepts a real state and newest sort", () => {
    const p = parseSearchParams({ q: "loan", state: "VERIFIED", sort: "newest", page: "4" });
    expect(p).toEqual({ q: "loan", page: 4, state: "VERIFIED", sort: "newest" });
  });
});

describe("pagination math", () => {
  it("0 matches is 0 pages; a partial page is 1 page", () => {
    expect(totalPages(0)).toBe(0);
    expect(totalPages(1)).toBe(1);
    expect(totalPages(PAGE_SIZE)).toBe(1);
    expect(totalPages(PAGE_SIZE + 1)).toBe(2);
  });

  it("caps pages and reports what the cap hid", () => {
    expect(totalPages(MAX_PAGES * PAGE_SIZE)).toBe(MAX_PAGES);
    expect(totalPages(MAX_PAGES * PAGE_SIZE + 1)).toBe(MAX_PAGES);
    expect(hiddenByCap(600)).toBe(0);
    expect(hiddenByCap(MAX_PAGES * PAGE_SIZE + 340)).toBe(340);
  });

  it("clamps pages into range and computes offsets", () => {
    expect(clampPage(99, 150)).toBe(3);
    expect(clampPage(0, 150)).toBe(1);
    expect(clampPage(5, 0)).toBe(1);
    expect(offsetFor(1)).toBe(0);
    expect(offsetFor(3)).toBe(2 * PAGE_SIZE);
  });
});

describe("hrefs", () => {
  const base = { q: "grid trading", page: 1, state: null, sort: "trusted" as const };

  it("keeps query, drops defaults, preserves filters and sort", () => {
    expect(pageHref(base, 1)).toBe("/search?q=grid+trading");
    expect(pageHref(base, 2)).toBe("/search?q=grid+trading&page=2");
    expect(pageHref({ ...base, state: "VERIFIED", sort: "newest", page: 3 }, 3))
      .toBe("/search?q=grid+trading&state=VERIFIED&sort=newest&page=3");
  });

  it("filter and sort links reset to page 1", () => {
    const p3 = { ...base, page: 7 };
    expect(stateHref(p3, "VERIFIED")).toBe("/search?q=grid+trading&state=VERIFIED");
    expect(stateHref({ ...p3, state: "VERIFIED" }, null)).toBe("/search?q=grid+trading");
    expect(sortHref(p3, "newest")).toBe("/search?q=grid+trading&sort=newest");
    expect(sortHref({ ...p3, sort: "newest" }, "trusted")).toBe("/search?q=grid+trading");
  });
});
