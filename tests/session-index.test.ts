/**
 * Session-index unit tests: the harvester and the upsert planner are pure
 * functions, so their honesty properties are pinnable without a chain.
 *
 * Each test is anchored to the failure it prevents: a misparsed topic
 * becoming a phantom session, a revoked key staying 'active' forever, or a
 * GEBO grant row being duplicated under a second key.
 */
import { describe, it, expect } from "vitest";
import { keccak256 } from "viem";
import {
  harvestWallets, planSessionUpserts, isAddressShapedTopic, keyIdMatches,
  type RawLog, type ChainKey, type ExistingRow,
} from "../src/lib/session-index.ts";

const ADDR = (hex: string) => `0x${hex.padStart(64, "0")}`;
const KEY = (hex: string) => `0x${hex.padEnd(64, "0")}`;

function log(topics: string[], block = 100n): RawLog {
  return { transactionHash: "0xabc", blockNumber: block, topics };
}

describe("isAddressShapedTopic", () => {
  it("accepts a left-padded address topic", () => {
    expect(isAddressShapedTopic(ADDR("688fe953e20225e0542ed11a11c708437e71d40e"))).toBe(true);
  });
  it("rejects a non-padded bytes32 (a keyId in topic1)", () => {
    expect(isAddressShapedTopic(KEY("b13a0aa4390807799"))).toBe(false);
  });
  it("rejects the zero address", () => {
    expect(isAddressShapedTopic(ADDR("0".repeat(40)))).toBe(false);
  });
  it("rejects malformed input", () => {
    expect(isAddressShapedTopic(undefined)).toBe(false);
    expect(isAddressShapedTopic("0x1234")).toBe(false);
  });
});

describe("harvestWallets", () => {
  it("collects distinct address-shaped topic1 wallets, lowercased", () => {
    const wallets = harvestWallets([
      log([KEY("deadbeef"), ADDR("688FE953e20225e0542ED11a11C708437e71d40e"), KEY("aa")]),
      log([KEY("cafebabe"), ADDR("688fe953e20225e0542ed11a11c708437e71d40e"), KEY("bb")]),
    ]);
    expect(wallets).toEqual(["0x688fe953e20225e0542ed11a11c708437e71d40e"]);
  });
  it("skips logs without an address-shaped topic1", () => {
    expect(harvestWallets([log([KEY("a"), KEY("b13a0aa4390807799")])])).toEqual([]);
    expect(harvestWallets([log([KEY("a")])])).toEqual([]);
  });
});

describe("planSessionUpserts", () => {
  const wallet = "0x688fe953e20225e0542ed11a11c708437e71d40e";
  const pub1 = "0x" + "ab".repeat(64);
  const pub2 = "0x" + "cd".repeat(64);

  it("new chain keys become inserts; known ones become refreshes", () => {
    const chain: ChainKey[] = [
      { keyId: keccak256(pub1 as `0x${string}`), publicKey: pub1, valid: true },
      { keyId: keccak256(pub2 as `0x${string}`), publicKey: pub2, valid: false },
    ];
    const existing: ExistingRow[] = [{ session_public_key: pub2, state: "active" }];
    const plan = planSessionUpserts(wallet, chain, existing);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]!.publicKey).toBe(pub1);
    expect(plan.refreshes).toHaveLength(1);
    expect(plan.refreshes[0]!.valid).toBe(false);
    expect(plan.deactivations).toHaveLength(0);
  });

  it("a key that left getKeys deactivates its row - never deleted, never left active", () => {
    const chain: ChainKey[] = [
      { keyId: keccak256(pub1 as `0x${string}`), publicKey: pub1, valid: true },
    ];
    const existing: ExistingRow[] = [
      { session_public_key: pub1, state: "active" },
      { session_public_key: pub2, state: "active" },
    ];
    const plan = planSessionUpserts(wallet, chain, existing);
    expect(plan.deactivations.map((d) => d.publicKey)).toEqual([pub2]);
  });

  it("keys without a recorded public key are skipped - nothing to key the row on", () => {
    const chain: ChainKey[] = [{ keyId: KEY("ff"), publicKey: null, valid: true }];
    const plan = planSessionUpserts(wallet, chain, []);
    expect(plan.inserts).toHaveLength(0);
  });

  it("empty chain key set against empty rows is a no-op", () => {
    expect(planSessionUpserts(wallet, [], [])).toEqual({
      inserts: [], refreshes: [], deactivations: [],
    });
  });
});

describe("keyIdMatches (v0 convention)", () => {
  it("keccak(publicKey) equals keyId for a real Altana key", () => {
    const pub = "0x" + "ab".repeat(64);
    expect(keyIdMatches(pub, keccak256(pub as `0x${string}`))).toBe(true);
    expect(keyIdMatches(pub, "0x" + "00".repeat(32))).toBe(false);
  });
});
