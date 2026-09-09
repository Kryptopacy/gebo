"use client";

/**
 * Accumulate agents into a shortlist across card visits, then jump to the
 * comparison. The button is the entry point; /shortlist?ids= is the state.
 *
 * localStorage only BRINGS ids between clicks - the shortlist page syncs it
 * to whatever was last on screen, so a removal there is respected here. No
 * fetch, no background sync: one write, one navigation.
 */
import { useEffect, useState } from "react";
import { readShortlistStorage, writeShortlistStorage } from "@/lib/shortlist-storage";

const MAX = 6;

export default function ShortlistButton({ tokenId }: { tokenId: string }) {
  const [inList, setInList] = useState<boolean | null>(null);

  useEffect(() => {
    setInList(readShortlistStorage().includes(tokenId));
  }, [tokenId]);

  const onClick = () => {
    let ids = readShortlistStorage();
    if (!ids.includes(tokenId)) ids = [...ids, tokenId];
    ids = ids.slice(0, MAX);
    writeShortlistStorage(ids);
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
