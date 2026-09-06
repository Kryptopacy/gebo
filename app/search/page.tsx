import { searchAgents, searchFacets, trustState, CATEGORIES, type CategorySlug } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Search agents — GEBO" };

/**
 * Search.
 *
 * "Find an agent" is a judged criterion, and until this existed the only way in
 * was category browsing - a user who already knew what they wanted had nowhere
 * to type it.
 *
 * Results are ordered by trust state first and relevance second, never by
 * popularity. A highly relevant agent that fails a protocol handshake is worse
 * than a slightly less relevant one that answers, and popularity is
 * self-reinforcing: in the largest comparable marketplace, rating count
 * correlated 0.33-0.71 with its own usage while rating value correlated ~0 with
 * anything. Every hit states why it matched.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  // Sequential, not Promise.all: two concurrent queries means two pool
  // connections on a cold instance, and concurrent connection establishment
  // through the Supabase pooler stalls hard enough from the deploy region to
  // hang the page. One connection, two round trips, renders in ~2s.
  const hits = q ? await searchAgents(q, 60) : [];
  const facets = q ? await searchFacets(q) : [];

  const byState = (s: string) => hits.filter((h) => trustState(h.agent).state === s).length;

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Search</p>

          <form
            method="get"
            action="/search"
            className="lookup"
            role="search"
            {...({
              toolname: "search_agents",
              tooldescription:
                "Search GEBO's registry of BNB Smart Chain agents by capability. Results state why each agent matched and are ordered by trust state, then relevance - never popularity.",
              toolautosubmit: "true",
            } as Record<string, string>)}
          >
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="What should the agent do? e.g. rebalance liquidity, watch my loan"
              aria-label="Search agents by capability"
              autoComplete="off"
              spellCheck={false}
              className="lookup-input"
              {...({
                toolparamdescription:
                  "What the agent should do, e.g. 'rebalance liquidity', 'watch my loan', 'x402 payments'",
              } as Record<string, string>)}
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
            <p className="sm t-3 mt-m" style={{ marginBottom: 0 }}>
              {hits.length === 0
                ? `Nothing matches "${q}".`
                : `${hits.length} agent${hits.length === 1 ? "" : "s"} match "${q}" ` +
                  `— ${byState("VERIFIED")} verified, ${byState("LISTED")} responding, ` +
                  `${byState("DORMANT")} unreachable, ${byState("SHADOWED")} uncallable.`}
            </p>
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
              Ordered by whether the agent answers, then by relevance. Never by popularity:
              usage counts are self-reinforcing and, where it has been measured, rating value
              carried no information about whether an agent worked.
            </p>
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
