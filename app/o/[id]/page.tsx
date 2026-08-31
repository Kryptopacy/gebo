import { notFound } from "next/navigation";
import {
  CATEGORIES, agentsInCategory, rankAgentsByLiveEvidence, diversify,
  trustState, classify, loadOpportunities, OPPORTUNITY_DETAIL_FIELDS,
  type CategorySlug,
} from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Chain state — GEBO" };

const VENUE_LABEL: Record<string, string> = {
  "pancakeswap-v3": "PancakeSwap V3",
  venus: "Venus",
};

/**
 * What a person who uses this venue does with the row - stated per venue, and
 * only for venues whose contracts we actually read. A venue with no entry here
 * gets no sentence rather than an invented one (invariant 3: no unscoped
 * claims, and no benefit language for a venue we do not index).
 */
const VENUE_BENEFIT: Record<string, string> = {
  "pancakeswap-v3":
    "If you provide liquidity on PancakeSwap, this row is the re-ranging decision: where the pool's liquidity sits relative to the current tick, the fee tier a position earns, and the MasterChef stake a farmed position must unwind before it can move.",
  venus:
    "If you lend or borrow on Venus, this row is the rate-and-risk picture: the unboosted supply APR, utilisation, and the liquidation parameters that decide how close to the edge a position is.",
};

/**
 * Fallback rendering for payload keys the detail spec does not recognise.
 * Deliberately dumb: no digit-count guessing, no scaling. An earlier version
 * divided any 15+ digit integer by 1e18 and printed "123.456e18", which was
 * actively wrong for sqrtPriceX96 (a 2^96 fixed point) and V3 liquidity (not
 * a token amount at all). Unknown means unknown - show it raw and say so.
 */
function rawValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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
    ? diversify(await rankAgentsByLiveEvidence(await agentsInCategory(o.category as CategorySlug)), 3)
    : [];

  const payload: Record<string, any> = o.payload ?? {};
  const block = typeof payload.readAtBlock === "string" ? payload.readAtBlock : null;
  const spec = OPPORTUNITY_DETAIL_FIELDS[o.category as CategorySlug] ?? [];
  const consumed = new Set(spec.map((f) => f.key));
  const rows = spec.flatMap((f) => {
    const cell = f.render(payload[f.key], payload);
    return cell ? [{ f, cell }] : [];
  });
  const rest = Object.entries(payload)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([k]) => !consumed.has(k));

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
          {VENUE_BENEFIT[o.venue] && (
            <p className="sm t-3 mt-m" style={{ maxWidth: "78ch", marginBottom: 0 }}>
              {VENUE_BENEFIT[o.venue]}
            </p>
          )}
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
            Every field the indexer captured for this row, translated: known fields carry their
            units and the assumptions they were computed under, and anything this page does not
            recognise is shown raw at the bottom - nothing is dropped. Values are as read from
            {` ${VENUE_LABEL[o.venue] ?? o.venue}`}
            {" "}at the block shown above; they age, so treat them as of that moment.
          </p>
          <div className="surface-card mt-m">
            {rows.length === 0 && rest.length === 0 ? (
              <dl className="spec">
                <div><dt>payload</dt><dd>— the indexer recorded no fields for this row</dd></div>
              </dl>
            ) : (
              <>
                <dl className="spec">
                  {rows.map(({ f, cell }) => (
                    <div key={f.key}>
                      <dt>{f.label}</dt>
                      <dd className={cell.mono ? "mono" : undefined}>
                        {cell.text}
                        {cell.note && <div className="note">{cell.note}</div>}
                      </dd>
                    </div>
                  ))}
                </dl>
                {rest.length > 0 && (
                  <>
                    <p className="section-label" style={{ margin: "18px 0 0" }}>Other recorded fields</p>
                    <p className="xs t-4" style={{ margin: "4px 0 0" }}>
                      Fields this page does not translate. Raw values, exactly as the indexer
                      recorded them - unscaled and unrounded.
                    </p>
                    <dl className="spec">
                      {rest.map(([k, v]) => (
                        <div key={k}>
                          <dt className="mono">{k}</dt>
                          <dd className="mono" title={typeof v === "string" && v.length > 42 ? v : undefined}>
                            {rawValue(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
              </>
            )}
          </div>
          {cat?.judged && (
            <p className="xs t-4 mt-m" style={{ maxWidth: "78ch" }}>
              Measured against {cat.counterfactual}. An agent working on this position is measured
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
