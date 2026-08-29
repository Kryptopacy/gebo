"use client";

import { useState, type ReactNode } from "react";

/**
 * Switcher pills for the agent card, matching the category pages' pattern.
 *
 * The card answers four different questions - is it alive, what may it touch,
 * what does it declare, what has it done - and stacking them flat made each
 * answer a scroll away. Each tab renders server-built sections passed as
 * props, so no data or markup is duplicated client-side.
 */
const TABS = ["Overview", "Authority", "Registration", "Track record"] as const;
type Tab = (typeof TABS)[number];

export default function AgentTabs({
  overview,
  authority,
  registration,
  trackRecord,
  badges,
}: {
  overview: ReactNode;
  authority: ReactNode;
  registration: ReactNode;
  trackRecord: ReactNode;
  badges?: Partial<Record<Tab, number>>;
}) {
  const [tab, setTab] = useState<Tab>("Overview");

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
              // var(--surface) was never defined in any theme block, so a pill
              // rail renders transparent; --ink-850 is the design system's
              // raised-surface token.
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
                  // Dark ink on the yellow accent; var(--bg) is undefined.
                  color: tab === t ? "#0c0e12" : "var(--fg-3)",
                  transition: "all 0.15s",
                }}
              >
                {t}
                {badges?.[t] != null && (
                  <span style={{ marginLeft: 6, opacity: 0.7, fontSize: "0.8em" }}>
                    {badges[t]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {tab === "Overview" && overview}
      {tab === "Authority" && authority}
      {tab === "Registration" && registration}
      {tab === "Track record" && trackRecord}
    </>
  );
}
