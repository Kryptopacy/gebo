/**
 * The client-side cache of the shortlist, shared by every button that adds to
 * it (agent card, search rows) and synced by the shortlist page itself.
 *
 * THE URL IS CANONICAL; this storage is only the bridge that lets an "add"
 * button on another page know what the user last had on screen. The sync rule
 * that keeps it honest: whenever the shortlist page renders, it writes its
 * resolved ids back here. Without that, a removal on the page (a URL change)
 * never reached the storage, and the next "add" resurrected the agent the
 * user had just removed - found by walking the flow, not by review.
 *
 * Every operation is defensive: storage can be disabled (private mode),
 * corrupted by an older format, or hold junk. A read that cannot be trusted
 * returns an empty list, and a write that cannot happen is skipped - the
 * button still navigates with the ids it has.
 */
export const SHORTLIST_STORAGE_KEY = "gebo-shortlist";

const TOKEN_ID = /^\d{1,10}$/;

export function readShortlistStorage(): string[] {
  try {
    const raw = localStorage.getItem(SHORTLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of parsed) {
      if (typeof x !== "string" || !TOKEN_ID.test(x)) continue;
      const canon = String(BigInt(x));
      if (seen.has(canon)) continue;
      seen.add(canon);
      out.push(canon);
    }
    return out.slice(0, 6);
  } catch {
    return [];
  }
}

export function writeShortlistStorage(ids: string[]): void {
  try {
    localStorage.setItem(SHORTLIST_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* unavailable: the URL still carries the state */
  }
}
