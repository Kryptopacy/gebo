"use client";

import { useState, type ReactNode } from "react";

/**
 * Switcher pills for the methodology page, matching the category/agent tabs pattern.
 * Five distinct sections that users reference independently.
 */
const TABS = [
  "What is measured",
  "Refuses to show",
  "How ranking works",
  "How categories evolve",
  "Defects",
] as const;
type Tab = (typeof TABS)[number];

export default function MethodologyTabs({
  measures,
  refused,
  ranking,
  categories,
  defects,
  stats,
}: {
  measures: ReactNode;
  refused: ReactNode;
  ranking: ReactNode;
  categories: ReactNode;
  defects: ReactNode;
  stats?: { distinctOperators: number; sampled: number; topOperatorShare: number };
}) {
  const [tab, setTab] = useState<Tab>("What is measured");

  return (
    <>
      {/* Tab switcher pills */}
      <section className="band-tight">
        <div className="shell">
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "4px",
              background: "var(--ink-850)",
              borderRadius: 10,
              width: "fit-content",
              flexWrap: "wrap",
            }}
          >
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: tab === t ? 600 : 400,
                  background: tab === t ? "var(--accent)" : "transparent",
                  color: tab === t ? "#0c0e12" : "var(--fg-3)",
                  transition: "all 0.15s",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      {tab === "What is measured" && measures}
      {tab === "Refuses to show" && refused}
      {tab === "How ranking works" && ranking}
      {tab === "How categories evolve" && categories}
      {tab === "Defects" && defects}
    </>
  );
}