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

interface CategoriesDropdownProps {
  categories: CategoryWithCount[];
}

export function CategoriesDropdown({ categories }: CategoriesDropdownProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    timerRef.current = setTimeout(() => {
      setOpen(false);
    }, 220);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (timerRef.current) clearTimeout(timerRef.current);
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const allCategories = categories;

  return (
    <div
      ref={dropdownRef}
      className="nav-dropdown-wrapper"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className={`nav-dropdown-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span>Jobs & Categories</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`nav-dropdown-chevron ${open ? "is-rotated" : ""}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className="nav-dropdown-menu"
          role="menu"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="nav-dropdown-section">
            <div className="nav-dropdown-header">Agent Jobs</div>
            <div className="nav-dropdown-grid">
              {allCategories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/c/${c.slug}`}
                  className="nav-dropdown-item"
                  onClick={() => setOpen(false)}
                >
                  <span className="nav-dropdown-label">{c.meta.job}</span>
                  <span className="nav-dropdown-desc">
                    {c.meta.blurb}
                    {c.count !== null ? ` · ${c.count} agents` : ""}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="nav-dropdown-footer">
            <Link href="/search" className="nav-dropdown-footer-link" onClick={() => setOpen(false)}>
              Search capability keywords (A2A, MCP, x402) →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}