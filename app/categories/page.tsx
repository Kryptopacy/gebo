import { loadAggregates, JUDGED_CATEGORIES, OTHER_CATEGORIES } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Categories — GEBO",
  description:
    "Every agent job category on GEBO: the four flagship BNB Smart Chain jobs and the adjacent capabilities, with audited agent counts.",
};

/**
 * The full category directory - one page, nine entries, flagship jobs first.
 *
 * The footer carries the four flagship jobs and points here; the header
 * dropdown shows everything for fast navigation. Counts render only when the
 * aggregate read succeeded (invariant 9: an unmeasured count is never zero).
 */
export default async function CategoriesPage() {
  const agg = await loadAggregates();
  const all = [...JUDGED_CATEGORIES, ...OTHER_CATEGORIES];

  return (
    <>
      <section className="band">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Categories</p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.7rem)" }}>
              Every job an agent on BSC can do for you.
            </h1>
            <p className="standfirst">
              Four flagship jobs first, then the adjacent capabilities agents verifiably
              perform. Each count is the audited surface - agents whose own text carries
              specific evidence for the category, not a guess from a name.
            </p>
          </div>
        </div>
      </section>

      <section className="band band-last">
        <div className="shell">
          <div className="data-table-frame mt-m">
            <div className="rows">
              <div className="rows-head" style={{ gridTemplateColumns: "minmax(0,1.8fr) 8rem minmax(0,0.9fr)" }}>
                <span>Job</span><span>Agents</span><span>Venue</span>
              </div>
              {all.map((c) => {
                const known = agg.live;
                const n = agg.categories[c.slug] ?? 0;
                return (
                  <a key={c.slug} href={`/c/${c.slug}`} className="row row-hover r-jobs">
                    <div>
                      <h3>{c.job}</h3>
                      <p className="xs t-3" style={{ margin: 0, maxWidth: "60ch" }}>{c.blurb}</p>
                    </div>
                    <div>
                      {known ? (
                        <>
                          <span className="num" style={{ fontSize: "1.4rem", color: n ? "var(--fg)" : "var(--fg-4)" }}>{n}</span>
                          <span className="xs t-4 num" style={{ marginLeft: 6 }}>audited</span>
                        </>
                      ) : (
                        <span className="xs t-4">unmeasured</span>
                      )}
                    </div>
                    <div className="sm t-3">{c.venue}</div>
                  </a>
                );
              })}
            </div>
          </div>
          {!agg.live && (
            <div className="notice mt-m">
              The agent counts behind this directory could not be read just now. The
              categories themselves are the audited structure; the numbers will return
              when the read succeeds.
            </div>
          )}
        </div>
      </section>
    </>
  );
}
