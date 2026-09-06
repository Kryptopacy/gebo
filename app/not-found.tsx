import Link from "next/link";

/**
 * The 404 page is where a marketplace loses people: a stale agent link, a
 * mistyped category, a renamed route. Default Next.js answers with a bare
 * "404" and a dead end. This one keeps the person: search is one field away,
 * the four judged categories are one click, and the wording says what
 * actually happened rather than apologising generically.
 */
export default function NotFound() {
  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Not found</p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.6rem)" }}>
              This page doesn&apos;t exist
            </h1>
            <p className="standfirst">
              The link may point to an agent that was never registered on the ERC-8004
              identity registry we index (BNB Smart Chain, chain 56), or to a page that
              moved. Search by capability is the fastest way to what you wanted.
            </p>
          </div>

          <form method="get" action="/search" className="lookup" role="search" style={{ maxWidth: "560px" }}>
            <input
              type="search"
              name="q"
              required
              maxLength={200}
              placeholder="What should the agent do? e.g. rebalance liquidity, watch my loan"
              aria-label="Search agents by capability"
              className="lookup-input"
            />
            <button type="submit" className="cta">Search</button>
          </form>

          <div className="inline-list mt-m" style={{ gap: 8 }}>
            <span className="xs t-4">Or browse:</span>
            <Link href="/categories" className="chip chip-flat" style={{ fontSize: 11 }}>All categories</Link>
            <Link href="/live" className="chip chip-flat" style={{ fontSize: 11 }}>Which agents are answering</Link>
            <Link href="/compare" className="chip chip-flat" style={{ fontSize: 11 }}>Agent vs. doing it yourself</Link>
            <Link href="/methodology" className="chip chip-flat" style={{ fontSize: 11 }}>How measurements are made</Link>
          </div>
        </div>
      </section>
    </>
  );
}
