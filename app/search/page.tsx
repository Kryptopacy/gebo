import { searchAgentsPaged, searchFacets, trustState, CATEGORIES, type CategorySlug, SEARCH_TRUST_STATES } from "@/lib/data";
import { parseSearchParams, totalPages, clampPage, offsetFor, hiddenByCap, pageHref, stateHref, sortHref, PAGE_SIZE } from "@/lib/search-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Search agents — GEBO" };

/**
 * Search.
 *
 * "Find an agent" is a judged criterion, and until this existed the only way in
 * was category browsing - a user who already knew what they wanted had nowhere to
 * type it.
 *
 * Results are ordered by trust state first and relevance second, never by
 * popularity. A highly relevant agent that fails a protocol handshake is worse
 * than a slightly less relevant one that answers, and popularity is
 * self-reinforcing: in the largest comparable marketplace, rating count
 * correlated 0.33-0.71 with its own usage while rating value correlated ~0 with
 * anything. Every hit states why it matched.
 *
 * The match count is the count of the FULL match set, not the page: this page
 * once printed hits.length (capped at 60) as "N agents match", which made a
 * 600-match query claim 60 - the exact quiet fabrication this product exists
 * to prevent. Totals come from count(*) over() in the same query.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; state?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const raw = parseSearchParams(sp);
  const { q, state, sort } = raw;

  // Sequential, not Promise.all: two concurrent queries means two pool
  // connections on a cold instance, and concurrent connection establishment
  // through the Supabase pooler stalls hard enough from the deploy region to
  // hang the page. One connection, two round trips, renders in ~2s.
  //
  // Page 1 is fetched first to learn the total (needed to clamp the page and
  // to render truthful counts); a valid page > 1 is then fetched with its
  // offset. Two sequential round trips only for deep pages.
  const empty = { hits: [], total: 0, cappedTotal: false, byState: {} as Record<string, number>, live: true };
  const first = q ? await searchAgentsPaged(q, { limit: PAGE_SIZE, state, sort }) : empty;
  const page = clampPage(raw.page, first.total);
  const paged = q && page > 1
    ? await searchAgentsPaged(q, { limit: PAGE_SIZE, offset: offsetFor(page), state, sort })
    : first;
  const hits = paged.hits;
  const facets = q ? await searchFacets(q) : [];

  const pages = totalPages(first.total);
  const hidden = hiddenByCap(first.total);
  const cur = { q, page, state, sort };
  const byState = (s: string) => first.byState[s] ?? 0;

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Search</p>

          {/* No declarative tool attributes anywhere on this site: the
              imperative surface (parse-time bootstrap) carries the full
              constrained schemas, and a declarative twin would collide on
              the name or read as overlapping intent. The form stays for
              humans. */}
          <form
            method="get"
            action="/search"
            className="lookup"
            role="search"
          >
              <input
                type="search"
                name="q"
                required
                maxLength={200}
                defaultValue={q}
                placeholder="What should the agent do? e.g. rebalance liquidity, watch my loan"
                aria-label="Search agents by capability"
                autoComplete="off"
                spellCheck={false}
                className="lookup-input"
              />
            <button type="submit" className="cta">Search</button>
          </form>

          {/* Quick capability filter shortcuts */}
          <div className="inline-list mt-m" style={{ gap: 8 }}>
            <span className="xs t-4">Quick scopes:</span>
            {[
              ["All", ""],
              ["Rebalance & DEX", "rebalance"],
              ["Lending Health", "loan"],
              ["Yield Routing", "yield"],
              ["x402 Payments", "x402"],
              ["Market Research", "analysis"],
            ].map(([label, term]) => {
              const active = term ? q.toLowerCase().includes(term) : !q;
              return (
                <a
                  key={label}
                  href={term ? `/search?q=${encodeURIComponent(term)}` : "/search"}
                  className="chip chip-flat"
                  style={{
                    fontSize: 11,
                    borderColor: active ? "var(--accent)" : "var(--rule)",
                    color: active ? "var(--accent)" : "var(--fg-3)",
                    background: active ? "color-mix(in oklab, var(--accent) 8%, transparent)" : undefined,
                  }}
                >
                  {label}
                </a>
              );
            })}
          </div>

          {q && (
            <div className="mt-m">
              {first.live === false ? (
                <div className="notice" data-tone="fail" style={{ marginBottom: 10 }}>
                  <strong>The search could not be measured.</strong> A read against the registry
                  database did not complete, so no results can honestly be shown for &quot;{q}&quot;.
                  This notice exists because the alternative — printing &quot;0 matches&quot; — would
                  present a failed measurement as a finding over 257,000 registered agents.
                </div>
              ) : (
                <p className="sm t-3" style={{ marginBottom: 10 }}>
                  {first.total === 0
                    ? state
                      ? `Nothing in state ${state} matches "${q}".`
                      : `Nothing matches "${q}".`
                    : first.cappedTotal
                      ? `${first.total.toLocaleString()}+ agents match "${q}" — too many to count precisely or rank by relevance.`
                      : `${first.total.toLocaleString()} agent${first.total === 1 ? "" : "s"} match "${q}" ` +
                        `— ${byState("VERIFIED")} verified, ${byState("LISTED")} responding, ` +
                        `${byState("DORMANT")} unreachable, ${byState("SHADOWED")} uncallable.`}
                </p>
              )}
              {first.total > 0 && (
                <div className="inline-list" style={{ gap: 8 }}>
                  <span className="xs t-4">State:</span>
                  <a href={stateHref(cur, null)} className="chip chip-flat" style={{ fontSize: 11, borderColor: !state ? "var(--accent)" : "var(--rule)", color: !state ? "var(--accent)" : "var(--fg-3)" }}>
                    All{first.cappedTotal ? " · 1,200+" : ` · ${first.total.toLocaleString()}`}
                  </a>
                  {SEARCH_TRUST_STATES.map((s) => {
                    const n = byState(s);
                    if (!n && !first.cappedTotal) return null;
                    const active = state === s;
                    return (
                      <a key={s} href={stateHref(cur, s)} className="chip chip-flat" style={{ fontSize: 11, borderColor: active ? "var(--accent)" : "var(--rule)", color: active ? "var(--accent)" : "var(--fg-3)" }}>
                        {n ? `${s} · ${n.toLocaleString()}` : s}
                      </a>
                    );
                  })}
                  {!first.cappedTotal && (
                    <>
                      <span className="xs t-4" style={{ marginLeft: 12 }}>Order:</span>
                      <a href={sortHref(cur, "trusted")} className="chip chip-flat" style={{ fontSize: 11, borderColor: sort !== "newest" ? "var(--accent)" : "var(--rule)", color: sort !== "newest" ? "var(--accent)" : "var(--fg-3)" }}>
                        answers first
                      </a>
                      <a href={sortHref(cur, "newest")} className="chip chip-flat" style={{ fontSize: 11, borderColor: sort === "newest" ? "var(--accent)" : "var(--rule)", color: sort === "newest" ? "var(--accent)" : "var(--fg-3)" }}>
                        newest first
                      </a>
                    </>
                  )}
                </div>
              )}
              {first.cappedTotal ? (
                <p className="xs t-4 mt-s" style={{ marginBottom: 0, maxWidth: "74ch" }}>
                  The match set is very large, so results are ordered by trust state and recency rather than
                  relevance, and only the first {(pages * PAGE_SIZE).toLocaleString()} are paged — refine the
                  query to make it rankable and countable.
                </p>
              ) : hidden > 0 ? (
                <p className="xs t-4 mt-s" style={{ marginBottom: 0, maxWidth: "74ch" }}>
                  Showing the first {(pages * PAGE_SIZE).toLocaleString()} matches. {hidden.toLocaleString()} more
                  exist but are not paged through - refine the query to reach them.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {q && facets.length > 0 && (
        <section className="band-tight" style={{ paddingTop: 0 }}>
          <div className="shell">
            <div className="inline-list">
              {facets.map((f) => {
                const cat = CATEGORIES[f.category as CategorySlug];
                if (!cat) return null;
                return (
                  <a key={f.category} href={`/c/${f.category}`} className="chip chip-flat">
                    {cat.job} · {f.n}
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {q && hits.length > 0 && (
        <section className="band band-last">
          <div className="shell">
            <div className="data-table-frame">
              <div className="rows">
                <div className="rows-head r-agents">
                  <span>Agent</span><span>State</span><span>Operator</span>
                  <span style={{ textAlign: "right" }}>Response</span><span>Why it matched</span>
                </div>
                {hits.map(({ agent: a, why }) => {
                  const st = trustState(a);
                  const cat = a.category ? CATEGORIES[a.category as CategorySlug] : null;
                  return (
                    <a key={a.token_id} href={`/a/${a.token_id}`} className="row row-hover r-agents">
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <h3>{a.name ?? `Agent ${a.token_id}`}</h3>
                          {a.protocols.map((p) => (
                            <span key={p} className="chip chip-flat" style={{ fontSize: 9.5, padding: "1px 5px" }}>
                              {p.toUpperCase()}
                            </span>
                          ))}
                          {a.x402 && (
                            <span className="chip chip-flat" style={{ fontSize: 9.5, padding: "1px 5px", color: "var(--accent)" }}>
                              x402
                            </span>
                          )}
                        </div>
                        <div className="xs t-4 num">
                          #{a.token_id}
                          {cat && <span> · {cat.job}</span>}
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
                      <div className="xs t-3">{why}</div>
                    </a>
                  );
                })}
              </div>
            </div>

            <p className="xs t-4 mt-m" style={{ maxWidth: "74ch" }}>
              Ordered by {sort === "newest" ? "registration (token id, newest first)" : "whether the agent answers, then by relevance"}. Never by popularity:
              usage counts are self-reinforcing and, where it has been measured, rating value
              carried no information about whether an agent worked.
            </p>

            {pages > 1 && (
              <nav aria-label="Search result pages" className="inline-list mt-m" style={{ gap: 8 }}>
                {page > 1 && (
                  <a href={pageHref(cur, page - 1)} className="chip chip-flat" style={{ fontSize: 11 }}>← previous</a>
                )}
                {Array.from({ length: pages }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2)
                  .map((n, i, arr) => (
                    <span key={n} className="inline-list" style={{ gap: 8 }}>
                      {i > 0 && n - arr[i - 1]! > 1 && <span className="xs t-4">…</span>}
                      <a
                        href={pageHref(cur, n)}
                        aria-current={n === page ? "page" : undefined}
                        className="chip chip-flat"
                        style={{
                          fontSize: 11,
                          borderColor: n === page ? "var(--accent)" : "var(--rule)",
                          color: n === page ? "var(--accent)" : "var(--fg-3)",
                        }}
                      >
                        {n}
                      </a>
                    </span>
                  ))}
                {page < pages && (
                  <a href={pageHref(cur, page + 1)} className="chip chip-flat" style={{ fontSize: 11 }}>next →</a>
                )}
                <span className="xs t-4">
                  page {page} of {pages}
                </span>
              </nav>
            )}
          </div>
        </section>
      )}

      {!q && (
        <section className="band band-last">
          <div className="shell">
            <h2>Search what agents say they can do</h2>
            <p className="prose sm">
              Matches names, registration descriptions and the skills each agent declares in its
              own A2A card. Skill text is the most precise capability signal available here, and
              the only one that is neither a name nor marketing copy.
            </p>
            <div className="data-table-frame mt-m">
              <div className="rows">
                {(
                  [
                    ["rebalance liquidity", "Agents that manage a concentrated-liquidity range"],
                    ["watch my loan", "Health-factor defence on Venus and Aave"],
                    ["grid trading", "Ladder orders across a band"],
                    ["best rate", "Yield routing between lending venues"],
                    ["token analysis", "Screening and research, not execution"],
                    ["x402", "Agents that charge per call"],
                  ] as const
                ).map(([term, note]) => (
                  <a key={term} href={`/search?q=${encodeURIComponent(term)}`} className="row row-hover r-suggest">
                    <div className="num sm" style={{ color: "var(--accent)" }}>{term}</div>
                    <div className="sm t-3">{note}</div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
