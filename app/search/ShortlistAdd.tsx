"use client";

/**
 * Add a search result to the shortlist WITHOUT navigating away - on the
 * search page you are still collecting candidates, and getting bounced to
 * the comparison after every add was exactly the back-and-forth this
 * feature exists to kill.
 *
 * First click stores (via the shared cache, which the shortlist page keeps
 * synced to whatever was last on screen) and confirms in place. Once the
 * agent is on the list, the button becomes the way IN: click again to open
 * the comparison. Storage failures degrade to navigating with the ids this
 * component knows about.
 */
import { useEffect, useState } from "react";
import { readShortlistStorage, writeShortlistStorage } from "@/lib/shortlist-storage";

const MAX = 6;

export default function ShortlistAdd({ tokenId }: { tokenId: string }) {
  const [onList, setOnList] = useState<boolean | null>(null);

  useEffect(() => {
    setOnList(readShortlistStorage().includes(tokenId));
  }, [tokenId]);

  const openShortlist = () => {
    window.location.href = `/shortlist?ids=${readShortlistStorage().join(",")}`;
  };

  const onClick = () => {
    const ids = readShortlistStorage();
    if (ids.includes(tokenId)) {
      openShortlist();
      return;
    }
    if (ids.length >= MAX) {
      // Full: open the comparison, where the remove links and the cap are
      // visible - deciding what to swap is a shortlist-page decision.
      openShortlist();
      return;
    }
    writeShortlistStorage([...ids, tokenId]);
    setOnList(true);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="chip chip-flat above-link"
      /* A phone is the primary device for this surface: the chip reads small
         but the TARGET is a comfortable 34px - a 10px-font, 2px-padding chip
         is ~18px tall and untappable with a thumb. */
      style={{ fontSize: 11, padding: "8px 12px", minHeight: 34, cursor: "pointer" }}
      aria-label={
        onList
          ? `Agent #${tokenId} is on your shortlist - open the comparison`
          : `Add agent #${tokenId} to your shortlist`
      }
    >
      {onList === null
        ? "shortlist"
        : onList
          ? "on shortlist · open →"
          : "+ shortlist"}
    </button>
  );
}
