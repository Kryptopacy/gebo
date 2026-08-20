import { describe, it, expect } from "vitest";
import { spendCap, formatCap, blastRadius, buildPermissions, canonicalise, PRESETS, TOKENS } from "../src/lib/session-scope.ts";

/**
 * The decimals footgun is the highest-severity bug class in this project.
 *
 * BNB Chain stablecoins use 18 decimals where other chains use 6, so a cap built
 * against the wrong assumption is out by a factor of a trillion - in the
 * direction of GRANTING an agent a trillion times the intended authority. It is
 * indistinguishable from a correct value until funds move, which is why it is
 * tested rather than reviewed.
 */
describe("spendCap", () => {
  it("scales whole amounts by the token's own decimals", () => {
    const cap = spendCap("USDT", "100", "day");
    // 18 decimals on BNB Chain, not the 6 the same symbol uses elsewhere.
    expect(cap.limit).toBe(100n * 10n ** 18n);
    expect(cap.decimals).toBe(18);
  });

  it("does not lose fractional precision", () => {
    expect(spendCap("WBNB", "0.05", "day").limit).toBe(5n * 10n ** 16n);
    expect(spendCap("WBNB", "0.000000000000000001", "day").limit).toBe(1n);
  });

  it("refuses an unknown token instead of assuming 18 decimals", () => {
    // Defaulting would produce a plausible-looking cap that is silently wrong.
    expect(() => spendCap("NOTATOKEN", "100", "day")).toThrow(/unknown token/i);
  });

  it("rejects amounts finer than the token can represent", () => {
    expect(() => spendCap("USDT", "0." + "0".repeat(18) + "1", "day")).toThrow(/precision/i);
  });

  it("rejects anything that is not a plain decimal", () => {
    for (const bad of ["1e18", "-5", "1,000", "100 ", "abc", ""]) {
      expect(() => spendCap("USDT", bad, "day")).toThrow();
    }
  });

  it("round-trips through formatCap", () => {
    for (const amount of ["100", "0.05", "1", "12345.6789"]) {
      const cap = spendCap("USDT", amount, "day");
      expect(formatCap(cap)).toBe(`${Number(amount)} USDT`.replace(/^(\d+) /, "$1 "));
    }
  });

  it("never produces a limit of zero for a non-zero amount", () => {
    for (const sym of Object.keys(TOKENS)) {
      expect(spendCap(sym, "0.01", "day").limit).toBeGreaterThan(0n);
    }
  });
});

describe("blastRadius", () => {
  it("reports no spending authority as the safe state, not an empty field", () => {
    const watchOnly = PRESETS.health!.find((p) => p.caps.length === 0)!;
    const r = blastRadius(watchOnly);
    expect(r.caps).toHaveLength(0);
    expect(r.worstCase).toMatch(/nothing/i);
    expect(r.unbounded).toBe(false);
  });

  it("flags a scope with a spend cap but no contract allowlist as unbounded", () => {
    // Altana: omitting `calls` lets a session reach ANY contract within its cap.
    const r = blastRadius({
      id: "x", name: "x", summary: "x",
      contracts: [], selectors: [],
      caps: [{ symbol: "USDT", amount: "100", period: "day" }],
      expiryHours: 24,
    });
    expect(r.unbounded).toBe(true);
    // Refusing to estimate is the honest answer when the ceiling is unknown.
    expect(r.worstCase).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/any contract/i);
  });

  it("warns on long expiries", () => {
    const r = blastRadius({
      id: "x", name: "x", summary: "x",
      contracts: ["PCS_SMART_ROUTER"], selectors: [],
      caps: [{ symbol: "USDT", amount: "1", period: "day" }],
      expiryHours: 24 * 60,
    });
    expect(r.warnings.join(" ")).toMatch(/expiry/i);
  });
});

describe("buildPermissions", () => {
  it("emits target-only call rules", () => {
    // Verified on BNB testnet: {to, signature} pairs authorise nothing and every
    // execute fails with NoSpendPermissions. Target-only is what the validator
    // matches. Regression guard for a bug that shipped once.
    const preset = PRESETS.grid!.find((p) => p.id === "standard")!;
    const perms = buildPermissions(preset);
    expect(perms.calls.length).toBeGreaterThan(0);
    for (const c of perms.calls) {
      expect(c.to).toBeDefined();
      expect((c as { signature?: string }).signature).toBeUndefined();
    }
  });

  it("produces one call rule per allowlisted contract", () => {
    const preset = PRESETS.rebalancing!.find((p) => p.id === "standard")!;
    expect(buildPermissions(preset).calls).toHaveLength(preset.contracts.length);
  });
});

describe("canonicalise", () => {
  it("is stable regardless of input ordering", () => {
    // Altana matches the session bytes on execute, so ordering must not vary.
    const a = canonicalise({
      calls: [{ to: "0xAAA" as `0x${string}` }, { to: "0xBBB" as `0x${string}` }],
      spend: [spendCap("USDT", "1", "day"), spendCap("WBNB", "1", "day")],
    });
    const b = canonicalise({
      calls: [{ to: "0xBBB" as `0x${string}` }, { to: "0xAAA" as `0x${string}` }],
      spend: [spendCap("WBNB", "1", "day"), spendCap("USDT", "1", "day")],
    });
    expect(a).toBe(b);
  });

  it("keeps bigint limits as decimal strings", () => {
    // Coercing to Number loses precision above 2^53 and breaks the byte match.
    const json = canonicalise({ calls: [], spend: [spendCap("USDT", "100", "day")] });
    expect(json).toContain("100000000000000000000");
    expect(JSON.parse(json).spend[0].limit).toBe("100000000000000000000");
  });

  it("lowercases addresses so casing cannot change the commitment", () => {
    const mixed = canonicalise({ calls: [{ to: "0xAbCdEf0000000000000000000000000000000000" as `0x${string}` }], spend: [] });
    const lower = canonicalise({ calls: [{ to: "0xabcdef0000000000000000000000000000000000" as `0x${string}` }], spend: [] });
    expect(mixed).toBe(lower);
  });
});
