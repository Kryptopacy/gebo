import { notFound } from "next/navigation";
import {
  CATEGORIES, type CategorySlug, loadAgents, agentsByCategory, rankAgents,
  diversify, trustState, classify, opportunitiesFor, OPPORTUNITY_COLUMNS,
} from "@/lib/data";
import CategoryTabs from "./CategoryTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
        opps={opps}
        eligible={eligible}
        ineligible={ineligible}
        cols={cols}
        oppGrid={oppGrid}
        tally={tally}
        cat={{ counterfactual: cat.counterfactual, floor: cat.floor, judged: cat.judged }}
        slug={slug}
      />
    </>
  );
}
