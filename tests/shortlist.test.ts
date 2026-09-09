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

  it("canonicalises leading zeros - 007 and 7 are one agent, not one row plus a false not-found", () => {
    expect(parseShortlistIds("007,7,00012")).toEqual(["7", "12"]);
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
    expect(addToShortlist(["1", "2"], "3"))
      .toEqual({ ids: ["1", "2", "3"], appended: ["3"], refusedByCap: [], duplicates: [], junkInput: false });
  });

  it("accepts a pasted LIST of ids - the first version silently ignored these", () => {
    expect(addToShortlist(["1"], "2, 3")).toEqual({
      ids: ["1", "2", "3"], appended: ["2", "3"], refusedByCap: [], duplicates: [], junkInput: false,
    });
  });

  it("canonicalises and dedupes within the paste itself", () => {
    expect(addToShortlist(["7"], "007, 8, 8")).toEqual({
      ids: ["7", "8"], appended: ["8"], refusedByCap: [], duplicates: ["7"], junkInput: false,
    });
  });

  it("reports a re-add as a duplicate rather than silently doing nothing", () => {
    expect(addToShortlist(["1", "2"], "2")).toEqual({
      ids: ["1", "2"], appended: [], refusedByCap: [], duplicates: ["2"], junkInput: false,
    });
  });

  it("reports junk input as junk - the page answers instead of ignoring the click", () => {
    expect(addToShortlist(["1"], "drop table")).toEqual({
      ids: ["1"], appended: [], refusedByCap: [], duplicates: [], junkInput: true,
    });
    expect(addToShortlist(["1"], "")).toEqual({
      ids: ["1"], appended: [], refusedByCap: [], duplicates: [], junkInput: false,
    });
    expect(addToShortlist(["1"], undefined)).toEqual({
      ids: ["1"], appended: [], refusedByCap: [], duplicates: [], junkInput: false,
    });
  });

  it("refuses beyond the cap, names what was refused, and keeps the additions that fit", () => {
    const full = ["1", "2", "3", "4", "5"];
    const r = addToShortlist(full, "6,7");
    expect(r).toEqual({
      ids: ["1", "2", "3", "4", "5", "6"],
      appended: ["6"],
      refusedByCap: ["7"],
      duplicates: [],
      junkInput: false,
    });
    expect(r.ids).toHaveLength(MAX_SHORTLIST);
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
