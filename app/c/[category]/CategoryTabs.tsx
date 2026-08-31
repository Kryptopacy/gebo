"use client";

import { useState } from "react";

type Agent = {
  token_id: string;
  name: string | null;
  trust_state: string | null;
  trust_reason: string | null;
  category: string | null;
  category_matched: string[] | null;
  operator: { registrableDomain: string | null } | null;
  probe: { grade: string; rttMs: number; httpStatus: number | null } | null;
};

type Opportunity = {
  id: string;
  label: string;
  venue: string;
  ref: string;
  eligible: boolean;
  ineligibleReason: string | null;
  /** Pre-formatted cell values, one per column, built on the server. */
  cells: string[];
};

type Column = {
  key: string;
  label: string;
  align?: "right";
};

const TABS = ["Agents", "Opportunities", "How it works"] as const;
type Tab = (typeof TABS)[number];

const VENUE_LABEL: Record<string, string> = {
  "pancakeswap-v3": "PancakeSwap V3",
  venus: "Venus",
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function CategoryTabs({
  ranked,
  opps,
  eligible,
  ineligible,
  cols,
  oppGrid,
  counts,
  cat,
  slug,
}: {
  ranked: Agent[];
  opps: Opportunity[];
  eligible: Opportunity[];
  ineligible: Opportunity[];
  cols: Column[];
  oppGrid: string;
  /** Precomputed trust-state tallies; functions cannot cross the RSC boundary. */
  counts: { VERIFIED: number; LISTED: number; DORMANT: number; SHADOWED: number };
  cat: { counterfactual: string; floor: string; judged: boolean };
  slug: string;
}) {
  const [tab, setTab] = useState<Tab>("Agents");

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
              // var(--surface) was never defined in any theme block, so this
              // pill rail rendered transparent; --ink-850 is the token the
              // rest of the design system uses for raised surfaces.
              background: "var(--ink-850)",
              borderRadius: 10,
              width: "fit-content",
            }}
          >
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: tab === t ? 600 : 400,
                  background: tab === t ? "var(--accent)" : "transparent",
                  // Dark ink on the yellow accent, matching the assistant
                  // widget's on-accent text. var(--bg) was undefined.
                  color: tab === t ? "#0c0e12" : "var(--fg-3)",
                  transition: "all 0.15s",
                }}
              >
                {t}
                {t === "Agents" && (
                  <span style={{ marginLeft: 6, opacity: 0.7, fontSize: "0.8em" }}>
                    {ranked.length}
                  </span>
                )}
                {t === "Opportunities" && (
                  <span style={{ marginLeft: 6, opacity: 0.7, fontSize: "0.8em" }}>
                    {eligible.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Tab content */}
      {tab === "Agents" && (
        <section className="band">
          <div className="shell">
            <h2>Agents for this job</h2>
            <p className="prose sm" style={{ marginBottom: 0 }}>
              Verified agents first, then those that merely responded, then the unreachable.
              Within each, ordered by our measured 7-day uptime and response latency from
              the probe pipeline, where enough observations exist - never by popularity.
            </p>
            <p className="prose sm" style={{ marginBottom: 0 }}>
              No operator may take more than three places.
            </p>

            {ranked.length === 0 ? (
              <div className="surface-card mt-m">
                <h3>No audited agent describes this job yet</h3>
                <p className="sm t-3" style={{ margin: 0, maxWidth: "68ch" }}>
                  That is an empirical finding rather than an empty state. The opportunity
                  surface for this category is indexed from chain state and does not depend
                  on any agent existing.
                </p>
              </div>
            ) : (
              <div className="data-table-frame mt-m">
                <div className="rows">
                  <div className="rows-head r-agents">
                    <span>Agent</span>
                    <span>State</span>
                    <span>Operator</span>
                    <span style={{ textAlign: "right" }}>Response</span>
                    <span>Why this rank</span>
                  </div>
                  {ranked.map((a, i) => (
                    <a
                      key={a.token_id}
                      href={`/a/${a.token_id}`}
                      className="row row-hover r-agents"
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span className="rank-badge" data-rank={i + 1}>
                          {i + 1}
                        </span>
                        <div>
                          <h3>{a.name ?? `Agent ${a.token_id}`}</h3>
                          <div className="xs t-4 num">
                            #{a.token_id}
                            {a.category_matched && a.category_matched.length > 0 && (
                              <span>
                                {" "}
                                &middot; matched &ldquo;{a.category_matched[0]}&rdquo;
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div>
                        <span className="chip" data-state={a.trust_state ?? "DORMANT"}>
                          {a.trust_state ?? "DORMANT"}
                        </span>
                      </div>
                      <div className="num xs t-3">
                        {a.operator?.registrableDomain ?? "\u2014"}
                      </div>
                      <div className="num sm" style={{ textAlign: "right" }}>
                        {a.probe?.grade === "validated" ? (
                          <span style={{ color: "var(--pass)" }}>{a.probe.rttMs} ms</span>
                        ) : a.probe?.httpStatus ? (
                          <span className="t-4">{a.probe.httpStatus}</span>
                        ) : (
                          <span className="t-4">\u2014</span>
                        )}
                      </div>
                      <div className="xs t-3">{a.trust_reason}</div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "Opportunities" && (
        <section className="band">
          <div className="shell">
            <h2>Live on-chain opportunities</h2>
            <p className="prose sm" style={{ marginBottom: 0 }}>
              {/* Venue names come from the rows themselves, not a hardcoded
                  list, so the sentence can never claim a venue this category
                  does not actually index. */}
              Read directly from{" "}
              {opps.length > 0
                ? Array.from(new Set(opps.map((o) => VENUE_LABEL[o.venue] ?? o.venue))).join(" and ")
                : "the venues this category indexes"}
              . Visible whether or not a competent agent exists yet.
            </p>

            {opps.length === 0 ? (
              <div className="surface-card mt-m">
                <div className="sm t-3">
                  {cat.judged
                    ? "Opportunity indexing has not run for this category yet."
                    : "This category has no chain-derived opportunity surface."}
                </div>
              </div>
            ) : (
              <div className="data-table-frame mt-m">
                <div className="rows">
                  <div className="rows-head" style={{ gridTemplateColumns: oppGrid }}>
                    <span>Market</span>
                    {cols.map((c) => (
                      <span
                        key={c.key}
                        style={{ textAlign: c.align === "right" ? "right" : "left" }}
                      >
                        {c.label}
                      </span>
                    ))}
                  </div>
                  {eligible.slice(0, 8).map((o) => (
                    <a
                      key={o.id}
                      href={`/o/${o.id}`}
                      className="row row-hover"
                      style={{ gridTemplateColumns: oppGrid }}
                    >
                      <div>
                        <h3>{o.label}</h3>
                        <div className="xs t-4 num">
                          {VENUE_LABEL[o.venue] ?? o.venue} &middot; {o.ref.slice(0, 10)}&hellip;
                        </div>
                      </div>
                      {cols.map((c, i) => (
                        <div
                          key={c.key}
                          className="num sm"
                          style={{ textAlign: c.align === "right" ? "right" : "left" }}
                        >
                          {o.cells[i]}
                        </div>
                      ))}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {eligible.length > 8 && (
              <details className="mt-m">
                <summary
                  className="sm t-3"
                  style={{ cursor: "pointer", padding: "6px 0" }}
                >
                  + View {eligible.length - 8} more
                </summary>
                <div className="data-table-frame mt-m">
                  <div className="rows">
                    {eligible.slice(8).map((o) => (
                      <a
                        key={o.id}
                        href={`/o/${o.id}`}
                        className="row row-hover"
                        style={{ gridTemplateColumns: oppGrid }}
                      >
                        <div>
                          <h3>{o.label}</h3>
                          <div className="xs t-4 num">
                            {VENUE_LABEL[o.venue] ?? o.venue} &middot;{" "}
                            {o.ref.slice(0, 10)}&hellip;
                          </div>
                        </div>
                        {cols.map((c, i) => (
                          <div
                            key={c.key}
                            className="num sm"
                            style={{
                              textAlign: c.align === "right" ? "right" : "left",
                            }}
                          >
                            {o.cells[i]}
                          </div>
                        ))}
                      </a>
                    ))}
                  </div>
                </div>
              </details>
            )}

            {ineligible.length > 0 && (
              <details className="mt-m">
                <summary
                  className="sm t-3"
                  style={{ cursor: "pointer", padding: "6px 0" }}
                >
                  {ineligible.length} excluded positions
                </summary>
                <div className="data-table-frame mt-m">
                  <div className="rows">
                    {ineligible.slice(0, 12).map((o) => (
                      <a
                        key={o.id}
                        href={`/o/${o.id}`}
                        className="row row-hover"
                        style={{
                          gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)",
                        }}
                      >
                        <div className="sm t-3">{o.label}</div>
                        <div className="xs t-4">{o.ineligibleReason}</div>
                      </a>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </div>
        </section>
      )}

      {tab === "How it works" && (
        <section className="band band-last">
          <div className="shell">
            <h2>How GEBO handles this category</h2>

            <dl className="kpi-grid mt-m">
              <div className="kpi-card">
                <dt>Verified</dt>
                <dd
                  style={{
                    color: counts.VERIFIED ? "var(--pass)" : "var(--fg-4)",
                  }}
                >
                  {counts.VERIFIED}
                </dd>
                <div className="qualifier">Completed an A2A or MCP handshake</div>
              </div>
              <div className="kpi-card">
                <dt>Listed</dt>
                <dd>{counts.LISTED}</dd>
                <div className="qualifier">Responded without speaking the protocol</div>
              </div>
              <div className="kpi-card">
                <dt>Dormant</dt>
                <dd className="t-4">{counts.DORMANT}</dd>
                <div className="qualifier">No usable response from our probe</div>
              </div>
              <div className="kpi-card">
                <dt>Shadowed</dt>
                <dd
                  style={{
                    color: counts.SHADOWED ? "var(--fail)" : "var(--fg-4)",
                  }}
                >
                  {counts.SHADOWED}
                </dd>
                <div className="qualifier">
                  Fatal registration defect &mdash; uncallable by any client
                </div>
              </div>
            </dl>

            <div className="stack-sm mt-l" style={{ gap: 12 }}>
              <div className="notice">
                Performance in this category is measured{" "}
                <strong>{cat.counterfactual}</strong>. No figure appears until an agent
                has at least <strong>{cat.floor}</strong> behind it.
              </div>

              {slug === "yield" && (
                <div className="notice">
                  Rates are a <strong>simple annualisation</strong> of Venus&apos;s
                  per-block rate, assuming 10,512,000 blocks per year. BNB Chain is now
                  faster, so these figures <strong>understate</strong> the true rate.
                </div>
              )}

              {slug === "rebalancing" && (
                <div className="notice">
                  A farmed position&apos;s LP NFT is held by <strong>MasterChefV3</strong>,
                  not by you. Rebalancing it requires withdraw &rarr; modify &rarr; re-stake.
                </div>
              )}

              {slug === "health" && (
                <div className="notice">
                  Health factor is computed from per-market collateral, oracle prices and
                  collateral factors &mdash; not from a single liquidity call. The ratio is
                  the informative figure; liquidity alone is not.
                </div>
              )}

              {slug === "grid" && (
                <div className="notice">
                  Grid trading places a ladder of orders inside a price band. Tail risk is
                  catastrophic when the band breaks. Look for agents that declare their
                  range-exit behaviour and max drawdown.
                </div>
              )}

              <a href="/methodology" className="sm" style={{ color: "var(--accent)" }}>
                Full methodology and known defects &rarr;
              </a>
            </div>
          </div>
        </section>
      )}
    </>
  );
}