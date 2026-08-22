import { notFound } from "next/navigation";
import {
  CATEGORIES, type CategorySlug, loadAgents, agentsByCategory, rankAgents,
  diversify, trustState, classify, opportunitiesFor, OPPORTUNITY_COLUMNS,
} from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VENUE_LABEL: Record<string, string> = {
  "pancakeswap-v3": "PancakeSwap V3",
  venus: "Venus",
};

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!(category in CATEGORIES)) notFound();
  const slug = category as CategorySlug;
  const cat = CATEGORIES[slug];

  const inCat = agentsByCategory(await loadAgents()).get(slug) ?? [];
  const ranked = diversify(rankAgents(inCat), 3);

  const opps = await opportunitiesFor(slug);
  const eligible = opps.filter((o) => o.eligible);
  const ineligible = opps.filter((o) => !o.eligible);
  const cols = OPPORTUNITY_COLUMNS[slug] ?? [];
  const oppGrid = `minmax(0,1.6fr) ${cols.map(() => "7.5rem").join(" ")}`;

  const tally = (s: string) => inCat.filter((a) => trustState(a).state === s).length;
  const operators = new Set(inCat.map((a) => a.operator?.key)).size;

  return (
    <>
      {/* ── 1. Hero & Category Overview ──────────────────────────────── */}
      <section className="band-tight">
        <div className="shell">
          <p className="crumb">
            <a href="/">GEBO</a> <span className="t-4">/</span> {cat.job}
          </p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.7rem)" }}>{cat.job}</h1>
            <p className="standfirst">{cat.blurb}</p>
          </div>
          <div className="inline-list mt-m" style={{ gap: 8 }}>
            <span className="chip chip-flat">{cat.venue}</span>
            {cat.judged && <span className="chip chip-flat">indexed surface</span>}
            <span className="chip chip-flat" style={{ color: tally("VERIFIED") ? "var(--pass)" : "var(--fg-3)" }}>
              {tally("VERIFIED")} verified
            </span>
            <span className="chip chip-flat">{eligible.length} live opportunities</span>
            <span className="chip chip-flat">{inCat.length} audited</span>
            <span className="chip chip-flat">{operators} operators</span>
          </div>
        </div>
      </section>

      {/* ── 2. PRIMARY ACTION: Ranked Agents Directory ───────────────── */}
      <section className="band">
        <div className="shell">
          <p className="section-label">01 · Agent Leaderboard</p>
          <h2>Ranked by evidence, never by popularity</h2>
          <p className="prose sm">
            Verified agents first, then those that merely responded, then the unreachable.
            Within each tier no operator may take more than three places.
          </p>

          {ranked.length === 0 ? (
            <div className="surface-card mt-m">
              <div>
                <h3>No audited agent describes this job yet</h3>
                <p className="sm t-3" style={{ margin: 0, maxWidth: "68ch" }}>
                  That is an empirical finding rather than an empty state. The four jobs this registry is
                  built around are barely served on BNB Chain today. The opportunity surface
                  for this category below is indexed from chain state and does not depend on any
                  agent existing, so the work stays visible even when nobody is doing it.
                </p>
              </div>
            </div>
          ) : (
            <div className="data-table-frame mt-m">
              <div className="rows">
                <div className="rows-head r-agents">
                  <span>Agent</span><span>State</span><span>Operator</span>
                  <span style={{ textAlign: "right" }}>Response</span><span>Reason</span>
                </div>
                {ranked.map((a, i) => {
                  const st = trustState(a);
                  const m = classify(a);
                  return (
                    <a key={a.token_id} href={`/a/${a.token_id}`} className="row row-hover r-agents">
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span className="rank-badge" data-rank={i + 1}>{i + 1}</span>
                        <div>
                          <h3>{a.name ?? `Agent ${a.token_id}`}</h3>
                          <div className="xs t-4 num">
                            #{a.token_id}
                            {m.matched.length > 0 && <span> · matched “{m.matched[0]}”</span>}
                          </div>
                        </div>
                      </div>
                      <div><span className="chip" data-state={st.state}>{st.state}</span></div>
                      <div className="num xs t-3">{a.operator?.registrableDomain ?? "—"}</div>
                      <div className="num sm" style={{ textAlign: "right" }}>
                        {a.probe?.grade === "validated" ? (
                          <span style={{ color: "var(--pass)" }}>{a.probe.rttMs} ms</span>
                        ) : a.probe?.httpStatus ? (
                          <span className="t-4">{a.probe.httpStatus}</span>
                        ) : (
                          <span className="t-4">—</span>
                        )}
                      </div>
                      <div className="xs t-3">{st.reason}</div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── 3. SUPPORTING WORK: Live Opportunity Surface ─────────────── */}
      <section className="band">
        <div className="shell">
          <p className="section-label">02 · Live On-Chain Opportunities</p>
          <h2>The work available right now</h2>
          <p className="prose sm">
            GEBO does not wait for agents to list themselves. This surface is read directly from live
            chain state on PancakeSwap and Venus, so opportunities are visible whether or not a competent agent exists yet.
          </p>

          {opps.length === 0 ? (
            <div className="surface-card mt-m">
              <div className="sm t-3">
                {cat.judged
                  ? "Opportunity indexing has not run for this category yet."
                  : "This category has no chain-derived opportunity surface. Rebalancing, grid, yield and health factor map onto specific PancakeSwap and Venus state that can be indexed; the work here is not expressible as an on-chain position, so agents are listed on their measured behaviour instead."}
              </div>
            </div>
          ) : (
            <div className="data-table-frame mt-m">
              <div className="rows">
                <div className="rows-head" style={{ gridTemplateColumns: oppGrid }}>
                  <span>Market</span>
                  {cols.map((c) => (
                    <span key={c.key} style={{ textAlign: c.align === "right" ? "right" : "left" }}>
                      {c.label}
                    </span>
                  ))}
                </div>
                {eligible.slice(0, 8).map((o) => (
                  <div key={o.id} className="row" style={{ gridTemplateColumns: oppGrid }}>
                    <div>
                      <h3>{o.label}</h3>
                      <div className="xs t-4 num">
                        {VENUE_LABEL[o.venue] ?? o.venue} · {o.ref.slice(0, 10)}…
                      </div>
                    </div>
                    {cols.map((c) => (
                      <div key={c.key} className="num sm"
                        style={{ textAlign: c.align === "right" ? "right" : "left" }}>
                        {c.fmt(o.payload[c.key], o.payload)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {eligible.length > 8 && (
            <details className="mt-m">
              <summary className="sm t-3" style={{ cursor: "pointer", padding: "6px 0" }}>
                + View {eligible.length - 8} more live positions in this pool
              </summary>
              <div className="data-table-frame mt-m">
                <div className="rows">
                  {eligible.slice(8).map((o) => (
                    <div key={o.id} className="row" style={{ gridTemplateColumns: oppGrid }}>
                      <div>
                        <h3>{o.label}</h3>
                        <div className="xs t-4 num">
                          {VENUE_LABEL[o.venue] ?? o.venue} · {o.ref.slice(0, 10)}…
                        </div>
                      </div>
                      {cols.map((c) => (
                        <div key={c.key} className="num sm"
                          style={{ textAlign: c.align === "right" ? "right" : "left" }}>
                          {c.fmt(o.payload[c.key], o.payload)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}

          {ineligible.length > 0 && (
            <details className="mt-m">
              <summary className="sm t-3" style={{ cursor: "pointer", padding: "6px 0" }}>
                {ineligible.length} excluded positions — shown with the reason rather than dropped
              </summary>
              <div className="data-table-frame mt-m">
                <div className="rows">
                  {ineligible.slice(0, 12).map((o) => (
                    <div key={o.id} className="row"
                      style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)" }}>
                      <div className="sm t-3">{o.label}</div>
                      <div className="xs t-4">{o.ineligibleReason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      </section>

      {/* ── 4. POPULATION TALLY & METHODOLOGY CAVEATS ────────────────── */}
      <section className="band band-last">
        <div className="shell">
          <p className="section-label">03 · Census Breakdown & Criteria</p>
          <h2>Population verification status</h2>
          <dl className="kpi-grid mt-m">
            <div className="kpi-card">
              <dt>Verified</dt>
              <dd style={{ color: tally("VERIFIED") ? "var(--pass)" : "var(--fg-4)" }}>{tally("VERIFIED")}</dd>
              <div className="qualifier">Completed an A2A or MCP handshake</div>
            </div>
            <div className="kpi-card">
              <dt>Listed</dt>
              <dd>{tally("LISTED")}</dd>
              <div className="qualifier">Responded without speaking the protocol</div>
            </div>
            <div className="kpi-card">
              <dt>Dormant</dt>
              <dd className="t-4">{tally("DORMANT")}</dd>
              <div className="qualifier">No usable response from our probe</div>
            </div>
            <div className="kpi-card">
              <dt>Shadowed</dt>
              <dd style={{ color: tally("SHADOWED") ? "var(--fail)" : "var(--fg-4)" }}>{tally("SHADOWED")}</dd>
              <div className="qualifier">Fatal registration defect — uncallable by any client</div>
            </div>
          </dl>

          <details className="mt-l">
            <summary className="sm" style={{ cursor: "pointer", color: "var(--fg)", fontWeight: 550, padding: "8px 0" }}>
              Protocol rules, counterfactual judging & caveats ▾
            </summary>
            <div className="stack-sm mt-m" style={{ gap: 12 }}>
              <div className="notice">
                Performance in this category will be judged <strong>{cat.counterfactual}</strong>. No figure appears
                until an agent has at least <strong>{cat.floor}</strong> behind it — a flattering
                number drawn from a short record is worse than no number.
              </div>

              {slug === "yield" && (
                <div className="notice">
                  Rates are a <strong>simple annualisation</strong> of Venus&apos;s per-block rate,
                  assuming 10,512,000 blocks per year. Venus core assumes three-second blocks and
                  BNB Chain is now faster, so these figures <strong>understate</strong> the true
                  rate. Compounded APY is not shown because compounding frequency depends on
                  interaction, which cannot be observed per market.
                </div>
              )}

              {slug === "rebalancing" && (
                <div className="notice">
                  A farmed position&apos;s LP NFT is held by <strong>MasterChefV3</strong>, not by
                  you, so rebalancing it is withdraw, modify, re-stake — and the CAKE harvest has to
                  enter the accounting. Any agent that calls{" "}
                  <span className="num">decreaseLiquidity</span> directly will fail silently on a
                  staked position.
                </div>
              )}
            </div>
          </details>
        </div>
      </section>
    </>
  );
}
