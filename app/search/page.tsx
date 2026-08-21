import { searchAgents, searchFacets, trustState, CATEGORIES, type CategorySlug } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const [hits, facets] = q
    ? await Promise.all([searchAgents(q, 60), searchFacets(q)])
    : [[], []];

  const byState = (s: string) => hits.filter((h) => trustState(h.agent).state === s).length;

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Search</p>

          <form method="get" action="/search" className="lookup" role="search">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="What should the agent do? e.g. rebalance liquidity, watch my loan"
              aria-label="Search agents by capability"
              autoComplete="off"
              spellCheck={false}
              className="lookup-input"
            />
            <button type="submit" className="cta">Search</button>
          </form>

          {q && (
            <p className="sm t-3 mt-m" style={{ marginBottom: 0 }}>
              {hits.length === 0
                ? `Nothing matches "${q}".`
                : `${hits.length} agent${hits.length === 1 ? "" : "s"} match "${q}" ` +
                  `â€” ${byState("VERIFIED")} verified, ${byState("LISTED")} responding, ` +
                  `${byState("DORMANT")} unreachable, ${byState("SHADOWED")} uncallable.`}
            </p>
          )}
        </div>
      </section>

      {q && facets.length > 0 && (
        <section className="band-tight">
          <div className="shell">
            <div className="inline-list">
              {facets.map((f) => {
                const cat = CATEGORIES[f.category as CategorySlug];
                if (!cat) return null;
                return (
                  <a key={f.category} href={`/c/${f.category}`} className="chip chip-flat">
                    {cat.job} Â· {f.n}
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
                      <h3>{a.name ?? `Agent ${a.token_id}`}</h3>
                      <div className="xs t-4 num">
                        #{a.token_id}
                        {cat && <span> Â· {cat.job}</span>}
                      </div>
                    </div>
                    <div><span className="chip" data-state={st.state}>{st.state}</span></div>
                    <div className="num xs t-3">{a.operator?.registrableDomain ?? "â€”"}</div>
                    <div className="num sm" style={{ textAlign: "right" }}>
                      {a.probe?.grade === "validated" ? (
                        <span style={{ color: "var(--pass)" }}>{a.probe.rttMs} ms</span>
                      ) : a.probe?.httpStatus ? (
                        <span className="t-4">{a.probe.httpStatus}</span>
                      ) : (
                        <span className="t-4">â€”</span>
                      )}
                    </div>
                    <div className="xs t-3">{why}</div>
                  </a>
                );
              })}
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
            <div className="rows mt-m">
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
                <a key={term} href={`/search?q=${encodeURIComponent(term)}`} className="row row-hover" style={{ gridTemplateColumns: "14rem minmax(0,1fr)" }}>
                  <div className="num sm" style={{ color: "var(--accent)" }}>{term}</div>
                  <div className="sm t-3">{note}</div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
