/**
 * Keystore session indexing: turn on-chain Keystore logs into public.sessions
 * rows for ANY wallet, not just GEBO's own grants.
 *
 * WHY THIS SHAPE. The SDK ships no event ABI for the Keystore (verified:
 * only getKeys/getPublicKey/isValidKey/revokeKey functions exist in
 * @altananetwork/sdk's artifacts), and guessing event signatures is the
 * address-burning sin AGENTS.md forbids. So the index does NOT decode event
 * semantics at all. It harvests CANDIDATE WALLETS from logs - topic1 is
 * address-shaped on every Keystore event we have observed on real grant and
 * revoke receipts - and then reads each wallet through readAuthority(), the
 * same verified code path the authority console itself uses. The chain is
 * the source of truth; the logs are only discovery.
 *
 * HONESTY PROPERTIES (invariants 3 and 9):
 * - A wallet whose getKeys() is empty is skipped: nothing verifiable.
 * - Revoked keys are DROPPED from getKeys by the Keystore itself (verified,
 *   keystore.ts header), so a key that disappears between runs is marked
 *   inactive with its last_checked_at - never silently deleted, never
 *   reported active.
 * - The scope (allowlist, spend caps, expiry) is NOT readable from the
 *   registry for third-party keys - recorded as null and disclosed, never
 *   fabricated.
 */
import { keccak256, type Hex } from "viem";

/** A raw log as viem returns it - only the fields the harvester needs. */
export type RawLog = {
  transactionHash: string;
  blockNumber: bigint;
  topics: string[];
};

export function isAddressShapedTopic(topic: string | undefined): boolean {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return false;
  // An address in an indexed topic is left-padded with 12 zero bytes.
  if (topic.slice(2, 26) !== "0".repeat(24)) return false;
  const addr = topic.slice(26);
  return /^[0-9a-fA-F]{40}$/.test(addr) && /[1-9a-fA-F]/.test(addr);
}

/**
 * Distinct candidate wallets from Keystore logs: every topic1 that is
 * address-shaped. Deliberately over-inclusive - readAuthority() filters the
 * empty ones - because a missed wallet is a missed session, while a false
 * candidate costs one reverted read.
 */
export function harvestWallets(logs: RawLog[]): string[] {
  const out = new Set<string>();
  for (const log of logs) {
    const t = log.topics?.[1];
    if (isAddressShapedTopic(t)) out.add(`0x${t!.slice(26).toLowerCase()}`);
  }
  return [...out];
}

export type ChainKey = {
  keyId: string;
  publicKey: string | null;
  valid: boolean;
};

export type ExistingRow = {
  session_public_key: string | null;
  state: string | null;
};

export type SessionUpsertPlan = {
  /** Rows to insert (chain-verifiable keys we have no row for). */
  inserts: {
    wallet: string;
    publicKey: string;
    keyId: string;
    valid: boolean;
  }[];
  /** Existing rows to refresh: validity re-checked on chain. */
  refreshes: {
    wallet: string;
    publicKey: string;
    keyId: string;
    valid: boolean;
  }[];
  /** Existing rows whose key has left getKeys(): revoked, or expired-and-
   *  swept. Marked inactive with the check time - never deleted. */
  deactivations: { wallet: string; publicKey: string }[];
};

/**
 * Diff one wallet's CURRENT chain key set against our rows for that wallet.
 *
 * A key present on chain but absent here is an insert. Present in both is a
 * refresh. Present here but absent from getKeys() is a deactivation: the
 * Keystore drops revoked keys from getKeys immediately, so absence means
 * revoked (or never valid); expiry does NOT drop keys, so an expired-but-
 * listed key arrives as valid=false and is recorded as such.
 */
export function planSessionUpserts(
  wallet: string,
  chainKeys: ChainKey[],
  existing: ExistingRow[],
): SessionUpsertPlan {
  const plan: SessionUpsertPlan = { inserts: [], refreshes: [], deactivations: [] };
  const byPublicKey = new Map(
    existing
      .filter((r) => r.session_public_key)
      .map((r) => [r.session_public_key!.toLowerCase(), r]),
  );
  const seen = new Set<string>();
  for (const k of chainKeys) {
    if (!k.publicKey) continue; // no public key recorded: cannot key the row
    const pk = k.publicKey.toLowerCase();
    seen.add(pk);
    const row = {
      wallet,
      publicKey: k.publicKey,
      keyId: k.keyId,
      valid: k.valid,
    };
    if (byPublicKey.has(pk)) plan.refreshes.push(row);
    else plan.inserts.push(row);
  }
  for (const [pk, row] of byPublicKey) {
    if (!seen.has(pk)) {
      plan.deactivations.push({ wallet, publicKey: row.session_public_key! });
    }
  }
  return plan;
}

/** keyId convention check, exposed for tests: keccak(publicKey) === keyId. */
export function keyIdMatches(publicKey: string, keyId: string): boolean {
  try {
    return keccak256(publicKey as Hex).toLowerCase() === keyId.toLowerCase();
  } catch {
    return false;
  }
}
