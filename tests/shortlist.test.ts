/**
 * The shortlist's numbers and rules must be arithmetic, not vibes. The URL is
 * the product's state, and a parsing bug here quietly shows a user a
 * different comparison than the one they asked for - or shared.
 *
 * Also pins the two design laws this surface could most easily violate by
 * accident: the cap is disclosed rather than silent, and nothing in the
 * module produces a score, a rank or a "best" (L1/L3).
 */
import { describe, it, expect } from "vitest";
import {
  parseShortlistIds, addToShortlist, shortlistHref, MAX_SHORTLIST,
} from "../src/lib/shortlist.ts";

describe("parseShortlistIds", () => {
  it("parses, trims and preserves order", () => {
    expect(parseShortlistIds("265375, 12,7")).toEqual(["265375", "12", "7"]);
  });

  it("rejects non-numeric junk instead of coercing it", () => {
    expect(parseShortlistIds("abc,,-1,12.5,0x1,99999999999,8")).toEqual(["8"]);
  });

  it("deduplicates", () => {
    expect(parseShortlistIds("5,5,5,6,5")).toEqual(["5", "6"]);
  });

  it("does not cap - the page discloses the drop instead of hiding it here", () => {
    const ten = Array.from({ length: 10 }, (_, i) => String(100 + i)).join(",");
    expect(parseShortlistIds(ten)).toHaveLength(10);
  });

  it("handles missing, empty and whitespace-only input", () => {
    expect(parseShortlistIds(undefined)).toEqual([]);
    expect(parseShortlistIds("")).toEqual([]);
    expect(parseShortlistIds(" , , ")).toEqual([]);
  });
});

describe("addToShortlist", () => {
  it("appends a new id at the end", () => {
    expect(addToShortlist(["1", "2"], "3")).toEqual({ ids: ["1", "2", "3"], added: true, capped: false });
  });

  it("is idempotent - re-adding an existing id changes nothing", () => {
    expect(addToShortlist(["1", "2"], "2")).toEqual({ ids: ["1", "2"], added: false, capped: false });
  });

  it("refuses beyond the cap and says so, rather than silently dropping", () => {
    const full = ["1", "2", "3", "4", "5", "6"];
    const r = addToShortlist(full, "7");
    expect(r).toEqual({ ids: full, added: false, capped: true });
    expect(r.ids).toHaveLength(MAX_SHORTLIST);
  });

  it("ignores junk adds", () => {
    expect(addToShortlist(["1"], "drop table")).toEqual({ ids: ["1"], added: false, capped: false });
    expect(addToShortlist(["1"], "")).toEqual({ ids: ["1"], added: false, capped: false });
    expect(addToShortlist(["1"], undefined)).toEqual({ ids: ["1"], added: false, capped: false });
  });
});

describe("shortlistHref", () => {
  it("builds the canonical URL, comma-joined in list order", () => {
    expect(shortlistHref(["265375", "12"])).toBe("/shortlist?ids=265375,12");
  });

  it("an empty list is the bare route, not ?ids=", () => {
    expect(shortlistHref([])).toBe("/shortlist");
  });
});

describe("design laws the module must keep", () => {
  it("MAX_SHORTLIST is six - a decision, not a dump", () => {
    expect(MAX_SHORTLIST).toBe(6);
  });

  it("the module exports no score, rank or ordering function", async () => {
    // L1/L3: the comparison aligns evidence and stops there. If someone adds
    // a "pick the best" helper, this pin is where the review starts.
    const mod = Object.keys(await import("../src/lib/shortlist.ts"));
    for (const name of mod) {
      expect(/score|rank|best|winner|sort/i.test(name)).toBe(false);
    }
  });
});
