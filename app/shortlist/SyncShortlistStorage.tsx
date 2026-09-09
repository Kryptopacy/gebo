"use client";

import { useEffect } from "react";
import { writeShortlistStorage } from "@/lib/shortlist-storage";

/**
 * Keeps the client-side shortlist cache equal to what is on screen.
 *
 * The URL is the canonical state, but the "add" buttons on other pages read
 * localStorage to know what the user already collected. Before this sync
 * existed, removing an agent on this page changed the URL only - the next
 * "add" on a card resurrected the removed agent, because storage had gone
 * stale. Whatever shortlist the user last SAW becomes the list the next add
 * continues from, which is the least surprising rule available.
 *
 * Renders nothing; runs after hydration so SSR output is unaffected.
 */
export default function SyncShortlistStorage({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    writeShortlistStorage(key ? key.split(",") : []);
  }, [key]);
  return null;
}
