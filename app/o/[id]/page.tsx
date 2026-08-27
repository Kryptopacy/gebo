import { notFound } from "next/navigation";
import {
  CATEGORIES, loadAgents, agentsByCategory, rankAgentsByLiveEvidence, diversify,
  trustState, classify, loadOpportunities, type CategorySlug,
} from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VENUE_LABEL: Record<string, string> = {
  "pancakeswap-v3": "PancakeSwap V3",
  venus: "Venus",
};

/** Human-ish formatting for arbitrary chain-state values. */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : String(v);
  const s = String(v);
  // Big raw integers (liquidity, totals): render scaled where plausible.
  if (/^\d{15,}$/.test(s)) return `${(Number(s) / 1e18).toPrecision(6)}e18`;
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return `${s.slice(0, 10)}…${s.slice(-6)}`;
  return s;
}

/**
 * Opportunity detail - one row of indexed reality, in full.
 *
 * The category surface shows eight columns and stops; this shows everything the
 * indexer captured, including the caveats the payload carries inline (rate
 * basis, block assumptions). Selecting a row must lead somewhere deeper than
 * itself: a dead end here would be exactly the journey failure the rubric
 * names.
 */
export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  // Clients differ on whether they encode ":" in a path segment; Next passes
  // the param through as received, so normalise before matching.
  const id = decodeURIComponent(rawId);
  const all = await loadOpportunities();
  const o = all.find((x) => x.id === id);
  if (!o) notFound();

  const cat = CATEGORIES[o.category as CategorySlug];
  const inCat = cat
    ? diversify(await rankAgentsByLiveEvidence(agentsByCategory(await loadAgents()).get(o.category as CategorySlug) ?? []), 3)
    : [];

  const entries = Object.entries(o.payload ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const block = typeof o.payload?.readAtBlock === "string" ? o.payload.readAtBlock : null;

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb">
            <a href="/">GEBO</a> <span className="t-4">/</span>{" "}
            {cat ? <a href={`/c/${o.category}`}>{cat.job}</a> : o.category}{" "}
            <span className="t-4">/</span> <span>{o.label}</span>
          </p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.7rem, 3vw, 2.3rem)" }}>{o.label}</h1>
            <p className="standfirst">
              Indexed from live {VENUE_LABEL[o.venue] ?? o.venue} state. This is the work an
              agent would do, described by the chain rather than by anyone selling anything.
            </p>
          </div>
          <div className="inline-list mt-m" style={{ gap: 8 }}>
            <span className="chip chip-flat">{VENUE_LABEL[o.venue] ?? o.venue}</span>
            {o.eligible ? (
              <span className="chip" data-state="VERIFIED">eligible</span>
            ) : (
              <span className="chip" data-state="DORMANT">excluded</span>
            )}
            {block && <span className="chip chip-flat num">block {Number(block).toLocaleString()}</span>}
            <span className="chip chip-flat xs">{new Date(o.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
          </div>
          {!o.eligible && o.ineligibleReason && (
            <div className="notice mt-m" data-tone="fail">
              <strong>Excluded from the live surface:</strong> {o.ineligibleReason}. The row is
              retained and shown rather than silently dropped - a silent drop is indistinguishable
              from a bug.
            </div>
          )}
        </div>
      </section>

      <section className="band">
        <div className="shell">
          <h2>Chain state at index time</h2>
          <p className="prose sm">
            Every field the indexer captured for this row, unfiltered. Values are as read from
            {` ${VENUE_LABEL[o.venue] ?? o.venue}`}
            {" "}at the block shown above; they age, so treat them as of that moment.
          </p>
          <div className="surface-card mt-m">
            <dl className="spec">
              {entries.map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                  <dd className="mono" title={typeof v === "string" && v.length > 42 ? v : undefined}>
                    {fmtValue(v)}
                  </dd>
                </div>
              ))}
              {entries.length === 0 && (
                <div><dt>payload</dt><dd>— the indexer recorded no fields for this row</dd></div>
              )}
            </dl>
          </div>
          {cat?.judged && (
            <p className="xs t-4 mt-m" style={{ maxWidth: "78ch" }}>
              Judged against {cat.counterfactual}. An agent working on this position is measured
              against doing nothing, on the same capital over the same window.
            </p>
          )}
        </div>
      </section>

      <section className="band band-last">
        <div className="shell">
          <h2>{inCat.length > 0 ? "Agents audited for this job" : "No audited agent describes this job yet"}</h2>
          {inCat.length === 0 ? (
            <div className="surface-card mt-m">
              <p className="sm t-3" style={{ margin: 0 }}>
                That is an empirical finding, not an empty state. This position stays visible so the
                work can be seen whether or not anyone is competing to do it.
              </p>
            </div>
          ) : (
            <div className="data-table-frame mt-m">
              <div className="rows">
                <div className="rows-head r-agents">
                  <span>Agent</span><span>State</span><span>Operator</span><span>Reason</span>
                </div>
                {inCat.map((a) => {
                  const st = trustState(a);
                  const m = classify(a);
                  return (
                    <a key={a.token_id} href={`/a/${a.token_id}`} className="row row-hover r-agents">
                      <div>
                        <h3>{a.name ?? `Agent ${a.token_id}`}</h3>
                        <div className="xs t-4 num">#{a.token_id}</div>
                      </div>
                      <div><span className="chip" data-state={st.state}>{st.state}</span></div>
                      <div className="num xs t-3">{a.operator?.registrableDomain ?? "—"}</div>
                      <div className="xs t-3">{st.reason}</div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
