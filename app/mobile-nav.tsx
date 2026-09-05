"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import type { CategorySlug, CATEGORIES } from "@/lib/data";

type CategoryMeta = typeof CATEGORIES[CategorySlug];

interface CategoryWithCount {
  slug: CategorySlug;
  meta: CategoryMeta;
  /** null = the count read failed; render without a number rather than as zero. */
  count: number | null;
}

/**
 * The masthead's mobile state. Below 860px the bar carries the wordmark, the
 * theme toggle and this menu; the desktop nav (and its scrolling row of
 * links) moves off the bar, and search returns here - on a phone search is
 * still the fastest way into the registry, and hiding it left nothing but a
 * swipeable header.
 *
 * The panel reuses the desktop nav's destinations exactly, plus the same
 * category list the dropdown serves, so the two navigations cannot drift.
 */
export function MobileNav({ categories }: { categories: CategoryWithCount[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="mobile-nav" ref={rootRef}>
      <button
        type="button"
        className={`mobile-nav-trigger ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </>
          ) : (
            <>
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          className="mobile-nav-panel"
          id="mobile-nav-panel"
          onClick={(e) => {
            // Any link tap closes the panel; the form and category taps do not.
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <form method="get" action="/search" className="mobile-nav-search" role="search">
            <input
              type="search"
              name="q"
              placeholder="Search agents by capability..."
              aria-label="Search agents by capability"
              autoComplete="off"
              spellCheck={false}
            />
          </form>

          <div className="mobile-nav-links" aria-label="Primary">
            <Link href="/live">Liveness</Link>
            <Link href="/authority">Authority</Link>
            <Link href="/methodology">Methodology</Link>
          </div>

          <div className="nav-dropdown-header" style={{ marginTop: 12 }}>
            Agent Jobs
          </div>
          <div className="mobile-nav-cats">
            {categories.map((c) => (
              <Link key={c.slug} href={`/c/${c.slug}`} className="mobile-nav-cat">
                <span className="mobile-nav-cat-row">
                  <span className="mobile-nav-cat-title">{c.meta.title}</span>
                  {c.count !== null && (
                    <span className="nav-dropdown-count" aria-label={`${c.count} agents`}>
                      {c.count}
                    </span>
                  )}
                </span>
                <span className="mobile-nav-cat-job">{c.meta.job}</span>
              </Link>
            ))}
          </div>

          <Link href="/categories" className="mobile-nav-more">
            View all categories →
          </Link>
        </div>
      )}
    </div>
  );
}
