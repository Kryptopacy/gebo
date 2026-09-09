import type { Metadata } from "next";
import { headers } from "next/headers";
import { trustState, classify, CATEGORIES, type CategorySlug } from "@/lib/data";
import {
  parseShortlistIds, addToShortlist, shortlistHref, loadShortlist,
  MAX_SHORTLIST, type ShortlistAttest, type ShortlistMetric,
} from "@/lib/shortlist";
import SyncShortlistStorage from "./SyncShortlistStorage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Compare agents side by side — GEBO",
  description:
    "The agents you are considering for one job, in one view: liveness with observation counts, track records, verified reviews. No scores, no winner - the judgement stays yours.",
};

/**
 * The shortlist comparison.
 *
 * "Understand" step of the judged journey, plural: the agent card is a
 * compatibility/security sheet for one agent (L5), and deciding between
 * candidates used to mean walking cards in separate tabs with no aligned
 * columns. This page aligns the same measured dimensions and refuses to
 * conclude - no composite score, no "best pick", no popularity ordering
 * (L1/L3). Every figure keeps its window and observation count (L2), and
 * anything unmeasured says so with a reason rather than rendering as zero
 * or blank (invariant 9).
 *
 * URL-driven by design: ?ids= is the whole state, so a comparison is
 * shareable and the page's own remove/add links stay ordinary links.
 */

function pct1(n: number): string {
  return `${n >= 99.95 ? "100" : n.toFixed(1)}%`;
}

export default async function ShortlistPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; add?: string }>;
}) {
  const sp = await searchParams;

  // Resolve the list: parse, merge ?add=, cap with disclosure. Every add
  // outcome the page can name, it names - a paste that parses to nothing, a
  // duplicate, or a cap refusal each get their own notice, because the first
  // version of this form silently ignored a two-id paste and that silence is
  // the dead end this product does not ship.
  const parsed = parseShortlistIds(sp.ids);
  const merged = addToShortlist(parsed, sp.add);
  const ids = merged.ids.slice(0, MAX_SHORTLIST);
  const droppedByUrl = merged.ids.length - ids.length;

  // Provenance disclosure, same rule as the agent card: an agent whose
  // endpoint runs on a host this deployment answers on is GEBO-operated,
  // and a visitor comparing candidates is owed that fact per column.
  const requestHost = (await headers()).get("host")?.split(":")[0] ?? null;
  const ownHosts = new Set<string>(
    [
      requestHost,
      process.env.NEXT_PUBLIC_SITE_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_URL,
    ]
      .filter((u): u is string => !!u)
      .flatMap((u) => {
        try {
          return [new URL(u.startsWith("http") ? u : `https://${u}`).hostname];
        } catch {
          return [];
        }
      }),
  );
  const geboOperated = (urls: { url: string }[]): boolean =>
    urls.some((e) => {
      try { return ownHosts.has(new URL(e.url).hostname); } catch { return false; }
    });

  const header = (
    <section className="band-tight">
      <div className="shell">
        <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Shortlist</p>
        <div className="headline-pair">
          <div>
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.6rem)" }}>
              Compare the agents you&apos;re considering
            </h1>
            <p className="standfirst">
              The same measured dimensions, side by side, so the back-and-forth between
              cards stops being the job. There is no score and no winner on this page -
              liveness, track record and verified reviews are laid next to each other and
              the judgement stays yours.
            </p>
          </div>
        </div>
      </div>
    </section>
  );

  // ── empty state: nothing to compare yet ─────────────────────────────────
  if (!ids.length) {
    return (
      <>
        {header}
        <section className="band band-last">
          <div className="shell">
            <div className="surface-card">
              <h2>Nothing to compare yet</h2>
              <p className="prose sm">
                Build a shortlist three ways: press <strong>shortlist</strong> on a search
                result or an agent card, paste token ids below (up to {MAX_SHORTLIST}), or
                open a link someone sent you. The list lives in the URL, so a comparison is
                a link you can send someone.
              </p>
              <form method="get" action="/shortlist" className="lookup mt-m">
                <input
                  type="text"
                  name="add"
                  required
                  maxLength={64}
                  inputMode="numeric"
                  pattern="[0-9,\s]+"
                  placeholder="Agent token id, e.g. 265375"
                  aria-label="Add agents by token id"
                  autoComplete="off"
                  spellCheck={false}
                  className="lookup-input"
                />
                <button type="submit" className="cta">Add</button>
              </form>
              <p className="prose sm mt-m" style={{ marginBottom: 0 }}>
                Looking for candidates? <a href="/search" style={{ color: "var(--accent)" }}>Search by capability</a>{" "}
                or <a href="/categories" style={{ color: "var(--accent)" }}>browse the job categories</a>.
              </p>
            </div>
          </div>
        </section>
      </>
    );
  }

  // The comparison read: four bounded queries, one connection. An empty list
  // never reaches the database.
  const read = await loadShortlist(ids);
  const byId = new Map(read.agents.map((a) => [a.token_id, a]));

  return (
    <>
      {header}

      <section className="band band-last">
        <div className="shell">
          {/* The shortlist the user last saw becomes the list the next "add"
              continues from - without this, removing an agent here and adding
              from a card later resurrected the removal. */}
          <SyncShortlistStorage ids={ids} />

          {/* The add form carries the resolved list in a hidden field so additions
              compound; the remove links below rebuild the URL without one id.
              A paste of several ids ("265375, 259573") is accepted - that is
              how candidates get shared. */}
          <form method="get" action="/shortlist" className="lookup" style={{ maxWidth: 560 }}>
            <input type="hidden" name="ids" value={ids.join(",")} />
            <input
              type="text"
              name="add"
              maxLength={64}
              inputMode="numeric"
              pattern="[0-9,\s]+"
              placeholder={`Add by token id or ids (${ids.length}/${MAX_SHORTLIST})`}
              aria-label="Add agents by token id"
              autoComplete="off"
              spellCheck={false}
              className="lookup-input"
            />
            <button type="submit" className="cta" disabled={ids.length >= MAX_SHORTLIST}>Add</button>
          </form>

          {merged.junkInput && (
            <div className="notice mt-m" data-tone="hold">
              <strong>That does not look like token ids.</strong> Enter numeric ids as on an
              agent card or a shared link - e.g. <span className="num">265375</span> or{" "}
              <span className="num">265375, 259573</span>.
            </div>
          )}
          {merged.duplicates.length > 0 && (
            <div className="notice mt-m" data-tone="hold">
              {merged.duplicates.map((d) => `#${d}`).join(", ")}{" "}
              {merged.duplicates.length === 1 ? "is" : "are"} already on the shortlist.
            </div>
          )}
          {merged.refusedByCap.length > 0 && (
            <div className="notice mt-m" data-tone="hold">
              <strong>The shortlist is full.</strong> {merged.refusedByCap.length} id
              {merged.refusedByCap.length === 1 ? "" : "s"} ({merged.refusedByCap.map((d) => `#${d}`).join(", ")})
              {" "}not added - remove one first, so the comparison stays readable.
            </div>
          )}
          {droppedByUrl > 0 && (
            <div className="notice mt-m" data-tone="hold">
              <strong>Only the first {MAX_SHORTLIST} of {merged.ids.length} ids are shown.</strong>{" "}
              A longer list stops being a comparison; the cap is disclosed rather than silent.
            </div>
          )}
          {read?.agentsUnavailable && (
            <div className="notice mt-m" data-tone="fail">
              <strong>The registry read failed.</strong> This is a failure to measure, not a
              finding that these agents do not exist, so no comparison is shown.
              {read.agentsReason && (
                <p className="xs num" style={{ margin: "6px 0 0" }}>Reported cause: {read.agentsReason}</p>
              )}
            </div>
          )}
          {!read?.agentsUnavailable && read?.metricsUnavailable && (
            <div className="notice mt-m" data-tone="hold">
              Liveness metrics could not be read just now - the uptime and latency columns
              render as unmeasured rather than as zero.
            </div>
          )}

          {!read?.agentsUnavailable && (
            <div className="data-table-frame mt-m">
              <div className="rows">
                <div className="rows-head r-shortlist">
                  <span>Agent</span>
                  <span>State</span>
                  <span>Liveness (7-day window)</span>
                  <span>Track record</span>
                  <span>Verified reviews</span>
                  <span style={{ textAlign: "right" }}>Decide</span>
                </div>
                {ids.map((id) => {
                  const a = byId.get(id);
                  if (!a) {
                    // An id that resolved to nothing is a finding about the
                    // registry read, rendered as its own row - never skipped,
                    // which would quietly shorten the comparison.
                    return (
                      <div key={id} className="row r-shortlist">
                        <div>
                          <h3>Agent #{id}</h3>
                          <div className="xs t-4 num">not in the registry read</div>
                        </div>
                        <div><span className="chip chip-flat">not found</span></div>
                        <div className="xs t-4" data-m="Liveness">
                          Unmeasured - this id has no materialized agent row. The census
                          lags the chain; a just-minted agent appears once materialize
                          catches up.
                        </div>
                        <div className="xs t-4" data-m="Track record">—</div>
                        <div className="xs t-4" data-m="Verified reviews">—</div>
                        <div className="xs t-4" data-m="Decide">
                          <a href={shortlistHref(ids.filter((x) => x !== id))} className="chip chip-flat">remove</a>
                        </div>
                      </div>
                    );
                  }
                  const st = trustState(a);
                  const cat = classify(a).category;
                  const catMeta = cat ? CATEGORIES[cat as CategorySlug] : null;
                  const fatal = a.lint?.defects?.filter((d) => d.severity === "fatal") ?? [];
                  const metrics = read.metrics.get(id) ?? [];
                  const byMetric = new Map(metrics.map((m) => [m.metricId, m]));
                  const uptime = byMetric.get("uptime_7d") as ShortlistMetric | undefined;
                  const p50 = byMetric.get("latency_p50_7d") as ShortlistMetric | undefined;
                  const attest: ShortlistAttest | undefined = read.attest.get(id);
                  const reviewCount = read.reviews.get(id) ?? 0;
                  const others = ids.filter((x) => x !== id);

                  return (
                    <div key={id} className="row r-shortlist">
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <h3><a href={`/a/${id}`}>{a.name ?? `Agent ${id}`}</a></h3>
                          <a
                            href={shortlistHref(others)}
                            aria-label={`Remove ${a.name ?? `agent ${id}`} from the shortlist`}
                            className="chip chip-flat"
                            style={{ fontSize: 9.5, padding: "1px 6px" }}
                            title="Remove from shortlist"
                          >
                            ×
                          </a>
                        </div>
                        <div className="xs t-4 num">
                          #{id}{catMeta && <> · <a href={`/c/${catMeta.slug}`}>{catMeta.job}</a></>}
                        </div>
                        <div className="xs t-4 num">{a.operator?.registrableDomain ?? "operator unknown"}</div>
                        <div className="inline-list mt-s" style={{ gap: 4 }}>
                          {geboOperated(a.endpoints ?? []) && (
                            <span className="chip chip-flat" style={{ fontSize: 9, padding: "1px 5px" }}>GEBO-operated</span>
                          )}
                          {a.x402 && (
                            <span className="chip chip-flat" style={{ fontSize: 9, padding: "1px 5px" }}>x402</span>
                          )}
                          {a.protocols.map((p) => (
                            <span key={p} className="chip chip-flat" style={{ fontSize: 9, padding: "1px 5px" }}>
                              {p.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div data-m="State">
                        <span className="chip" data-state={st.state}>{st.state}</span>
                        <div className="xs t-4" style={{ marginTop: 4 }}>{st.reason}</div>
                      </div>

                      <div data-m="Liveness" className="stack-sm">
                        {a.probe ? (
                          <>
                            <div className="xs">
                              <span className="pulse-dot" data-status={a.probe.grade === "validated" ? "pass" : "fail"} />{" "}
                              handshake {a.probe.grade === "validated" ? "PASS" : a.probe.grade}{" "}
                              <span className="t-4">· {a.probe.kind}</span>
                              {a.probe.rttMs != null && (
                                <>{" · "}<span className="num">{a.probe.rttMs} ms</span></>
                              )}
                            </div>
                            <div className="xs t-4" style={{ marginTop: 0 }}>
                              latest probe, one observation from one region
                            </div>
                          </>
                        ) : (
                          <div className="xs t-4">
                            No probe yet. Agents with a declared endpoint are probed on the
                            next sweep; until then liveness is unmeasured, not down.
                          </div>
                        )}
                        {read.metricsUnavailable ? (
                          <div className="xs t-4">7-day metrics could not be read - unmeasured, not zero.</div>
                        ) : (
                          <>
                            <div className="xs">
                              uptime 7d{" "}
                              {uptime ? (
                                <>
                                  <span className="num" style={{ color: "var(--pass)" }}>{pct1(uptime.value)}</span>{" "}
                                  <span className="t-4">· n={uptime.qualifiers.obsCount} probes</span>
                                </>
                              ) : (
                                <span className="t-4">insufficient observations (needs 20 in the window)</span>
                              )}
                            </div>
                            <div className="xs">
                              p50 7d{" "}
                              {p50 ? (
                                <>
                                  <span className="num">{Math.round(p50.value)} ms</span>{" "}
                                  <span className="t-4">· n={p50.qualifiers.obsCount} probes</span>
                                </>
                              ) : (
                                <span className="t-4">insufficient observations</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      <div data-m="Track record" className="stack-sm">
                        {read.attestUnavailable ? (
                          <div className="xs t-4">Could not be read - unmeasured, not zero.</div>
                        ) : attest && attest.total > 0 ? (
                          <>
                            <div className="xs">
                              <span className="num">{attest.total}</span> attestation{attest.total === 1 ? "" : "s"}
                              {" · "}<span className="num">{attest.verified}</span> verified
                            </div>
                            <div className="xs t-3">
                              <span style={{ color: "var(--pass)" }}>{attest.succeeded} succeeded</span>
                              {attest.partial > 0 && <> · <span style={{ color: "var(--hold)" }}>{attest.partial} partial</span></>}
                              {attest.failed > 0 && <> · <span style={{ color: "var(--fail)" }}>{attest.failed} failed</span></>}
                              {attest.disputed > 0 && <> · <span style={{ color: "var(--fail)" }}>{attest.disputed} disputed</span></>}
                            </div>
                            {attest.baselined > 0 && (
                              <div className="xs t-4">
                                <span className="num">{attest.baselined}</span> run{attest.baselined === 1 ? "" : "s"}{" "}
                                <a href="/compare">timed both ways</a>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="xs t-4">
                            No attestations yet - no evidence-gated task has been recorded
                            for this agent. Absence of evidence, not evidence of absence.
                          </div>
                        )}
                      </div>

                      <div data-m="Verified reviews" className="stack-sm">
                        {read.reviewsUnavailable ? (
                          <div className="xs t-4">Could not be read - unmeasured, not zero.</div>
                        ) : reviewCount > 0 ? (
                          <>
                            <div className="xs"><span className="num">{reviewCount}</span> verified review{reviewCount === 1 ? "" : "s"}</div>
                            <div className="xs t-4">comments from completed escrow hires - on the <a href={`/a/${id}`}>card</a></div>
                          </>
                        ) : (
                          <div className="xs t-4">
                            None yet. A review requires a completed APEX hire with the
                            reviewer as client - an empty state, not a poor one.
                          </div>
                        )}
                      </div>

                      <div data-m="Decide" className="stack-sm" style={{ textAlign: "right" }}>
                        <a href={`/a/${id}/hire`} className="cta" style={{ fontSize: 12, padding: "6px 12px" }}>
                          {fatal.length ? "View safety details" : "Hire flow"}
                        </a>
                        <a href={`/a/${id}`} className="xs t-3">full card →</a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="xs t-4 mt-m" style={{ maxWidth: "74ch" }}>
            Ordering is the order you added - never popularity, usage or any derived score,
            which measure nothing about whether an agent works (the GPT Store measured rating
            value at roughly zero correlation with real usage). Figures carry their window and
            observation count; probing runs from one region and{" "}
            <a href="/methodology">its limits are published</a>. Verified reviews are anchored
            comments from completed escrow jobs, never a score.
          </p>
          <p className="xs t-4 mt-s" style={{ maxWidth: "74ch" }}>
            <strong>What this page does not compare:</strong> what each agent could do to your
            wallet. Grant scope, spend caps and blast radius are per-agent and per-wallet -
            they live on each card&apos;s Authority tab and the{" "}
            <a href="/authority">authority console</a>, and no comparison column here can
            substitute for reading them before you hire.
          </p>
        </div>
      </section>
    </>
  );
}
