"use client";

import { useEffect } from "react";

/**
 * Horizontal-overflow guard, active in development only.
 *
 * Runs on mount, on resize, and every few seconds (data loads late and
 * reflows tables). When any page grows wider than the viewport it logs the
 * pixel overhang and the widest offending elements with their classes, so a
 * table that overflows cannot slip through a manual pass - the console says
 * which selector to fix. Tree-shaken from production builds.
 */
export function OverflowGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const check = () => {
      const doc = document.documentElement;
      const overhang = doc.scrollWidth - window.innerWidth;
      if (overhang <= 0) return;

      const offenders: string[] = [];
      const seen = new Set<string>();
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        if (offenders.length >= 8) break;
        if (!el.offsetParent && el.tagName !== "BODY") continue; // skip hidden
        const right = el.getBoundingClientRect().right;
        if (right <= window.innerWidth + 1) continue;
        const key = `${el.tagName}.${[...el.classList].slice(0, 3).join(".")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        offenders.push(`${key} (right +${Math.round(right - window.innerWidth)}px)`);
      }

      console.warn(
        `[overflow-guard] page is ${overhang}px wider than the viewport. ` +
        `Widest elements: ${offenders.join(" | ") || "none attributed (check body padding)"}`,
      );
    };

    const timer = setInterval(check, 2500);
    window.addEventListener("resize", check);
    check();
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", check);
    };
  }, []);

  return null;
}
