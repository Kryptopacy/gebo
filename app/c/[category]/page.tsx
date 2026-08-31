import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  CATEGORIES, type CategorySlug, agentsInCategory, rankAgentsByLiveEvidence,
  diversify, trustState, classify, opportunitiesFor, OPPORTUNITY_COLUMNS,
} from "@/lib/data";
import CategoryTabs from "./CategoryTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const cat = CATEGORIES[category as CategorySlug];
  return { title: cat ? `${cat.title} — agents — GEBO` : "Category — GEBO" };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!(category in CATEGORIES)) notFound();
  const slug = category as CategorySlug;
  const cat = CATEGORIES[slug];

  const inCat = await agentsInCategory(slug);
  const ranked = diversify(await rankAgentsByLiveEvidence(inCat), 3);

  const opps = await opportunitiesFor(slug);
  // Cell values are formatted on the server: OPPORTUNITY_COLUMNS carries fmt
  // functions, and functions cannot cross the server/client boundary into
  // CategoryTabs. The client renders strings and alignment only.
  const colDefs = OPPORTUNITY_COLUMNS[slug] ?? [];
  const cols = colDefs.map(({ key, label, align }) => ({ key, label, align }));
  const oppsWithCells = opps.map((o) => ({
    ...o,
    cells: colDefs.map((c) => c.fmt(o.payload[c.key], o.payload)),
  }));
  const eligible = oppsWithCells.filter((o) => o.eligible);
  const ineligible = oppsWithCells.filter((o) => !o.eligible);
  // The market column keeps an 11rem floor: the grid and health categories
  // carry seven fixed 7.5rem columns (52.5rem) before it, and a bare
  // minmax(0, fr) track collapses to a sliver on narrower windows - the
  // "cut off" failure. With the floor, the grid holds its minimum width and
  // the table's rows region scrolls sideways instead of squeezing.
  const oppGrid = `minmax(11rem,1.6fr) ${cols.map(() => "7.5rem").join(" ")}`;

  const tally = (s: string) => inCat.filter((a) => trustState(a).state === s).length;
  const counts = {
    VERIFIED: tally("VERIFIED"),
    LISTED: tally("LISTED"),
    DORMANT: tally("DORMANT"),
    SHADOWED: tally("SHADOWED"),
  };
  const operators = new Set(inCat.map((a) => a.operator?.key)).size;

  return (
    <>
      {/* Hero */}
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

      {/* Tabbed content */}
      <CategoryTabs
        ranked={ranked}
        opps={oppsWithCells}
        eligible={eligible}
        ineligible={ineligible}
        cols={cols}
        oppGrid={oppGrid}
        counts={counts}
        cat={{ counterfactual: cat.counterfactual, floor: cat.floor, judged: cat.judged }}
        slug={slug}
      />
    </>
  );
}
