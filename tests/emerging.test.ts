import { describe, it, expect } from "vitest";
import { detectEmerging, warrantsReview, stripTitleEcho, type EmergingInput } from "../src/lib/emerging.ts";

/**
 * Emerging-capability detection, anchored to the noise it actually produced.
 *
 * Every case below is a term this detector really nominated against the live
 * corpus. It cleared four "strong candidates" on its first run and all four were
 * garbage - an operator name, two words from a memecoin title, and a function
 * word. These tests exist so the filters cannot loosen again, because a detector
 * that cries wolf is one nobody reads, and an unread detector means the taxonomy
 * silently stops tracking the ecosystem.
 */

/** Convenience: a row that declares a capability, with sane defaults. */
function row(over: Partial<EmergingInput> = {}): EmergingInput {
  return {
    name: "Agent",
    description: null,
    skills: ["something"],
    trustState: "VERIFIED",
    operatorDomain: null,
    operatorKey: "op-1",
    ...over,
  };
}

describe("stripTitleEcho", () => {
  it("removes the listing title and its slug, leaving only what was added", () => {
    // Real shape from the corpus: "<name> - <slug> - <description>", so the
    // title arrives three times and its words look like declared capability.
    const skill = "The White Swan by Unibase \u2014 the_white_swan_by_unibase \u2014 Expected. Nonviolent.";
    const left = stripTitleEcho(skill, "The White Swan by Unibase");
    expect(left).toBe("expected nonviolent");
  });

  it("returns empty when the skill is nothing but the title", () => {
    // "The Giga Swan by Unibase" declares no capability at all. An em dash used
    // as the separator previously survived normalisation and left a stray "-",
    // so this tested as non-empty and the listing was counted as evidence.
    const skill = "The Giga Swan by Unibase \u2014 the_giga_swan_by_unibase";
    expect(stripTitleEcho(skill, "The Giga Swan by Unibase")).toBe("");
  });

  it("keeps non-latin names intact rather than erasing them", () => {
    // A punctuation-class normaliser must not delete Japanese as though it were
    // a separator, or the agent's whole declaration vanishes.
    const left = stripTitleEcho("\u30d2\u30ca\u30df by Unibase \u2014 trending on X", "\u30d2\u30ca\u30df by Unibase");
    expect(left).toBe("trending on x");
  });
});

describe("detectEmerging - noise the corpus really produced", () => {
  it("refuses a term confined to a single operator", () => {
    // `unibase` was nominated on 17 verified texts. It is an operator, not a
    // job. One operator's vocabulary is branding; a capability is something at
    // least two independent parties describe the same way.
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({
        name: `Coin ${i} by Unibase`,
        skills: [`Coin ${i} by Unibase \u2014 unibase launches memecoins ${i}`],
        operatorKey: "unibase",
      }),
    );
    const result = detectEmerging(rows);
    expect(result.candidates.map((c) => c.term)).not.toContain("unibase");
    expect(result.suppressed.some((s) => s.term === "unibase" && /operator/.test(s.reason))).toBe(true);
  });

  it("admits a term two independent operators use", () => {
    // The mirror of the case above: same evidence volume, different provenance.
    // This is what a real emerging capability looks like.
    const rows = [
      row({ name: "A", skills: ["perpetuals funding arbitrage"], operatorKey: "op-a" }),
      row({ name: "B", skills: ["perpetuals basis capture"], operatorKey: "op-b" }),
      row({ name: "C", skills: ["perpetuals hedging desk"], operatorKey: "op-c" }),
    ];
    const result = detectEmerging(rows);
    const perp = result.candidates.find((c) => c.term === "perpetuals");
    expect(perp).toBeDefined();
    expect(perp!.distinctOperators).toBe(3);
    expect(warrantsReview(perp!)).toBe(true);
  });

  it("rejects function words, which a length filter let through", () => {
    // `not` was nominated on three verified texts because the previous filter
    // only rejected terms of two characters or fewer.
    const rows = ["op-a", "op-b", "op-c", "op-d"].map((k, i) =>
      row({ name: `N${i}`, skills: [`this does not represent the moment ${i}`], operatorKey: k }),
    );
    const result = detectEmerging(rows);
    expect(result.candidates.map((c) => c.term)).not.toContain("not");
    expect(result.candidates.map((c) => c.term)).not.toContain("the");
  });

  it("rejects venue and buzzword noise", () => {
    const rows = ["op-a", "op-b", "op-c"].map((k, i) =>
      row({ name: `V${i}`, skills: [`autonomous defi agent on bsc ${i}`], operatorKey: k }),
    );
    const terms = detectEmerging(rows).candidates.map((c) => c.term);
    for (const noise of ["defi", "bsc", "agent", "autonomous"]) {
      expect(terms).not.toContain(noise);
    }
  });

  it("never nominates vocabulary a rule already covers", () => {
    // Derived from RULES rather than hand-listed, so implementing a capability
    // silences its own term automatically. A hand-maintained exclusion list
    // drifts, and then the detector nominates what was just built.
    const rows = ["op-a", "op-b", "op-c"].map((k, i) =>
      row({ name: `R${i}`, skills: [`rebalancing concentrated liquidity ${i}`], operatorKey: k }),
    );
    const terms = detectEmerging(rows).candidates.map((c) => c.term);
    expect(terms).not.toContain("rebalancing");
    expect(terms).not.toContain("liquidity");
  });

  it("counts distinct texts, not agents, so mass minting cannot manufacture evidence", () => {
    // One author writing one sentence is one observation, however many
    // identities repeat it verbatim. Counting agents turned a single poetic
    // description into hundreds of independent observations.
    const rows = Array.from({ length: 50 }, () =>
      row({ name: "Clone", skills: ["identical zeppelin declaration"], operatorKey: "op-a" }),
    );
    const result = detectEmerging(rows);
    expect(result.examined).toBe(50);
    expect(result.distinctTexts).toBe(1);
    expect(result.candidates).toHaveLength(0);
  });

  it("counts a title-only skill as declaring nothing", () => {
    const rows = [
      row({ name: "Happiness Coin", skills: ["Happiness Coin \u2014 happiness_coin"] }),
      row({ name: "Giga Swan", skills: ["Giga Swan \u2014 giga_swan"] }),
    ];
    const result = detectEmerging(rows);
    expect(result.titleOnly).toBe(2);
    expect(result.distinctTexts).toBe(0);
  });

  it("treats unknown provenance as its own operator rather than as a free pass", () => {
    // Rows with no operator key must not collectively clear the multi-operator
    // bar: that would let anonymous listings mint a category between them.
    const rows = ["x", "y", "z"].map((s) =>
      row({ name: `Anon ${s}`, skills: [`quantum ${s} routing`], operatorKey: null }),
    );
    const result = detectEmerging(rows);
    expect(result.candidates.map((c) => c.term)).not.toContain("quantum");
  });

  it("ignores agents that declare no skills at all", () => {
    // Names and descriptions are excluded by design: branding lives there, and
    // it produced every false candidate the detector has ever raised.
    const rows = [
      row({ name: "Grid Titan Supreme", skills: null, description: "titan supreme trading" }),
      row({ name: "Titan Supreme Two", skills: [], description: "titan supreme trading" }),
    ];
    const result = detectEmerging(rows);
    expect(result.examined).toBe(0);
    expect(result.candidates).toHaveLength(0);
  });
});

describe("warrantsReview", () => {
  it("requires verified evidence across independent operators", () => {
    expect(warrantsReview({ term: "t", distinctTexts: 9, verifiedTexts: 9, distinctOperators: 1, examples: [] })).toBe(false);
    expect(warrantsReview({ term: "t", distinctTexts: 9, verifiedTexts: 2, distinctOperators: 4, examples: [] })).toBe(false);
    expect(warrantsReview({ term: "t", distinctTexts: 9, verifiedTexts: 3, distinctOperators: 2, examples: [] })).toBe(true);
  });
});
