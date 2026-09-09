"use client";

/**
 * Accumulate agents into a shortlist across card visits, then jump to the
 * comparison. The button is the entry point; /shortlist?ids= is the state.
 *
 * localStorage only BRINGS ids between clicks - the URL is canonical once the
 * comparison page renders, and every link there is an ordinary server-built
 * href. No fetch, no background sync: one write, one navigation. Ids beyond
 * the cap of six are dropped here and the page re-discloses the cap anyway,
 * because the honest place to say "too many" is the page with the remove
 * links, not a silent trim in storage.
 */
import { useEffect, useState } from "react";

const KEY = "gebo-shortlist";
const MAX = 6;

function readIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && /^\d{1,10}$/.test(x));
  } catch {
    return [];
  }
}

export default function ShortlistButton({ tokenId }: { tokenId: string }) {
  const [inList, setInList] = useState<boolean | null>(null);

  useEffect(() => {
    setInList(readIds().includes(tokenId));
  }, [tokenId]);

  const onClick = () => {
    let ids = readIds();
    if (!ids.includes(tokenId)) ids = [...ids, tokenId];
    ids = ids.slice(0, MAX);
    try {
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      /* storage unavailable (private mode): navigate with just this agent */
    }
    window.location.href = `/shortlist?ids=${ids.join(",")}`;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-quiet"
      aria-label={inList ? "Open your shortlist comparison" : "Add this agent to your shortlist"}
    >
      {inList === null ? "Shortlist" : inList ? "Open shortlist →" : "Add to shortlist →"}
    </button>
  );
}
