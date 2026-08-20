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
      <section className="band">
        <div className="shell">
          <p className="crumb">
            <a href="/">GEBO</a> <span className="t-4">/</span> {cat.job}
          </p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.7rem)" }}>{cat.job}</h1>
            <p className="standfirst">{cat.blurb}</p>
          </div>
          <div className="inline-list mt-m">
            <span className="chip chip-flat">{cat.venue}</span>
            {cat.judged && <span className="chip chip-flat">indexed surface</span>}
            <span className="chip chip-flat">{eligible.length} live opportunities</span>
            <span className="chip chip-flat">{inCat.length} agents audited</span>
            <span className="chip chip-flat">{operators} operators</span>
          </div>
        </div>
      </section>

      {/* ── the work that exists, whether or not an agent does ──── */}
      <section className="band">
        <div className="shell">
          <p className="section-label">
            Indexed from chain · {eligible.length} eligible of {opps.length} found
          </p>
          <h2>The work available right now</h2>
          <p className="prose sm">
            GEBO does not wait for agents to list themselves. This surface is read from live
            chain state, so the opportunities are real even where nobody is serving them yet.
          </p>

          {opps.length === 0 ? (
            <div className="rows mt-m">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <div className="sm t-3">
                  {cat.judged
                    ? "Opportunity indexing has not run for this category yet."
                    : "This category has no chain-derived opportunity surface. Rebalancing, grid, yield and health factor map onto specific PancakeSwap and Venus state that can be indexed; the work here is not expressible as an on-chain position, so agents are listed on their measured behaviour instead."}
                </div>
              </div>
            </div>
          ) : (
            <div className="rows mt-m">
              <div className="rows-head" style={{ gridTemplateColumns: oppGrid }}>
                <span>Market</span>
                {cols.map((c) => (
                  <span key={c.key} style={{ textAlign: c.align === "right" ? "right" : "left" }}>
                    {c.label}
                  </span>
                ))}
              </div>
              {eligible.slice(0, 14).map((o) => (
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
          )}

          {ineligible.length > 0 && (
            <details className="mt-m">
              <summary className="sm t-3" style={{ cursor: "pointer" }}>
                {ineligible.length} excluded — shown with the reason rather than dropped
              </summary>
              <div className="rows mt-m">
                {ineligible.slice(0, 12).map((o) => (
                  <div key={o.id} className="row"
                    style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)" }}>
                    <div className="sm t-3">{o.label}</div>
                    <div className="xs t-4">{o.ineligibleReason}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {slug === "yield" && (
            <div className="notice mt-l">
              Rates are a <strong>simple annualisation</strong> of Venus&apos;s per-block rate,
              assuming 10,512,000 blocks per year. Venus core assumes three-second blocks and
              BNB Chain is now faster, so these figures <strong>understate</strong> the true
              rate. Compounded APY is not shown because compounding frequency depends on
              interaction, which cannot be observed per market.
            </div>
          )}

          {slug === "rebalancing" && (
            <div className="notice mt-l">
              A farmed position&apos;s LP NFT is held by <strong>MasterChefV3</strong>, not by
              you, so rebalancing it is withdraw, modify, re-stake — and the CAKE harvest has to
              enter the accounting. Any agent that calls{" "}
              <span className="num">decreaseLiquidity</span> directly will fail silently on a
              staked position.
            </div>
          )}
        </div>
      </section>

      <section className="band-tight">
        <div className="shell">
          <dl className="readouts">
            <div className="readout">
              <dt>Verified</dt>
              <dd style={{ color: tally("VERIFIED") ? "var(--pass)" : "var(--fg-4)" }}>{tally("VERIFIED")}</dd>
              <div className="qualifier">Completed an A2A or MCP handshake</div>
            </div>
            <div className="readout">
              <dt>Listed</dt>
              <dd>{tally("LISTED")}</dd>
              <div className="qualifier">Responded without speaking the protocol</div>
            </div>
            <div className="readout">
              <dt>Dormant</dt>
              <dd className="t-4">{tally("DORMANT")}</dd>
              <div className="qualifier">No usable response from our probe</div>
            </div>
            <div className="readout">
              <dt>Shadowed</dt>
              <dd style={{ color: tally("SHADOWED") ? "var(--fail)" : "var(--fg-4)" }}>{tally("SHADOWED")}</dd>
              <div className="qualifier">Fatal registration defect — uncallable by any client</div>
            </div>
          </dl>

          <div className="notice mt-l">
            Performance in this category will be judged {cat.counterfactual}. No figure appears
            until an agent has at least <strong>{cat.floor}</strong> behind it — a flattering
            number drawn from a short record is worse than no number.
          </div>
        </div>
      </section>

      <section className="band band-last">
        <div className="shell">
          <h2>Ranked by evidence, never by popularity</h2>
          <p className="prose sm">
            Verified agents first, then those that merely responded, then the unreachable.
            Within each tier no operator may take more than three places.
          </p>

          {ranked.length === 0 ? (
            <div className="rows mt-m">
              <div className="row" style={{ gridTemplateColumns: "1fr" }}>
                <div>
                  <h3>No audited agent describes this job</h3>
                  <p className="sm t-3" style={{ margin: 0, maxWidth: "68ch" }}>
                    That is a finding rather than an empty state. The four jobs this registry is
                    built around are barely served on BNB Chain today. The opportunity surface
                    for this category is indexed from chain state and does not depend on any
                    agent existing, so the work is visible even when nobody is doing it.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rows mt-m">
              <div className="rows-head r-agents">
                <span>Agent</span><span>State</span><span>Operator</span>
                <span style={{ textAlign: "right" }}>Response</span><span>Reason</span>
              </div>
              {ranked.map((a) => {
                const st = trustState(a);
                const m = classify(a);
                return (
                  <a key={a.token_id} href={`/a/${a.token_id}`} className="row row-hover r-agents">
                    <div>
                      <h3>{a.name ?? `Agent ${a.token_id}`}</h3>
                      <div className="xs t-4 num">
                        #{a.token_id}
                        {m.matched.length > 0 && <span> · matched “{m.matched[0]}”</span>}
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
          )}
        </div>
      </section>
    </>
  );
}
