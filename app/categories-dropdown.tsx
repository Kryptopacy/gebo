"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

export function CategoriesDropdown() {
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
    }, 220); // 220ms grace period so moving cursor never drops menu
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
            <div className="nav-dropdown-header">Verified Jobs (Judged)</div>
            <div className="nav-dropdown-grid">
              <Link href="/c/rebalancing" className="nav-dropdown-item" onClick={() => setOpen(false)}>
                <span className="nav-dropdown-label">Rebalancing</span>
                <span className="nav-dropdown-desc">PancakeSwap V3 range manager</span>
              </Link>
              <Link href="/c/grid" className="nav-dropdown-item" onClick={() => setOpen(false)}>
                <span className="nav-dropdown-label">Grid Trading</span>
                <span className="nav-dropdown-desc">Order ladder automation</span>
              </Link>
              <Link href="/c/yield" className="nav-dropdown-item" onClick={() => setOpen(false)}>
                <span className="nav-dropdown-label">Yield Routing</span>
                <span className="nav-dropdown-desc">Lending optimizer across pools</span>
              </Link>
              <Link href="/c/health" className="nav-dropdown-item" onClick={() => setOpen(false)}>
                <span className="nav-dropdown-label">Health Factor</span>
                <span className="nav-dropdown-desc">Liquidation defence on Venus</span>
              </Link>
            </div>
          </div>

          <div className="nav-dropdown-section nav-dropdown-section-alt">
            <div className="nav-dropdown-header">Ecosystem Categories</div>
            <div className="nav-dropdown-grid">
              <Link href="/c/trading" className="nav-dropdown-item" onClick={() => setOpen(false)}>
                <span className="nav-dropdown-label">Trading & Execution</span>
                <span className="nav-dropdown-desc">DCA, arbitrage, intent solvers</span>
              </Link>
              <Link href="/c/research" className="nav-dropdown-item" onClick={() => setOpen(false)}>
                <span className="nav-dropdown-label">Research & Screening</span>
                <span className="nav-dropdown-desc">Token analysis, signal screening</span>
              </Link>
              <Link href="/c/payments" className="nav-dropdown-item" onClick={() => setOpen(false)}>
                <span className="nav-dropdown-label">Payments (x402)</span>
                <span className="nav-dropdown-desc">Per-call micropayment agents</span>
              </Link>
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
