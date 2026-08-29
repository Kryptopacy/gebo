import { loadAgents, funnel, POPULATION, loadCategoryCandidates } from "@/lib/data";
import { METRIC_DEFS, OBS_FLOOR, WINDOW as METRIC_WINDOW } from "@/lib/metrics";
import MethodologyTabs from "./MethodologyTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MEASURES = [
  {
    name: "handshake",
    definition:
      "A2A: fetch the declared endpoint, parse JSON, require a name plus at least one of skills, capabilities or url. MCP: post a JSON-RPC initialize and require a result carrying protocolVersion, serverInfo or capabilities.",
    window: "single observation",
    defect: "A valid card proves the interface exists. It does not prove the agent performs its job.",
  },
  {
    name: "round trip",
    definition: "Wall-clock time to a complete response body.",
    window: "single observation",
    defect:
      "Measured from one region and not averaged. Cold starts inflate it: in sampling, the highest-scoring agents were 3.3× slower at the median than mass-minted ones, because they do real work. Fast is not good.",
  },
  {
    name: "registration audit",
    definition:
      "Static analysis of declared endpoints for unsubstituted template placeholders, non-HTTP schemes, loopback and private hosts, bare IP addresses, and placeholder domains.",
    window: "at ingest",
    defect: "Catches only what is visible without a request. A well-formed URL can still point at nothing.",
  },
  {
    name: "operator identity",
    definition:
      "The registrable domain of the endpoint host, falling back to the owner address. Tenant platforms such as vercel.app and fly.dev keep their subdomain so unrelated operators are not merged.",
    window: "at ingest",
    defect:
      "Heuristic public-suffix handling rather than the Public Suffix List. One operator spread across unrelated domains counts as several.",
  },
  {
    name: "uptime and percentiles",
    definition: `Published from the metric registry once an agent clears ${OBS_FLOOR} probes in a ${METRIC_WINDOW} window. Until then the field reads insufficient observations, because deriving a percentage from one observation would be dishonest.`,
    window: `${METRIC_WINDOW} window`,
    defect:
      "Computed per agent across all its declared endpoints; a multi-endpoint agent's figure blends them. The registry entry carries the full formula and defects.",
  },
  ...Object.entries(METRIC_DEFS).map(([id, d]) => ({
    name: id.replace(/_/g, " "),
    definition: `${d.display}: ${d.formula}. Denominator: ${d.denominator}. Costs: ${d.costTreatment}.`,
    window: METRIC_WINDOW,
    defect: d.knownDefects.join(" "),
  })),
];

const REFUSED = [
  ["Star ratings", "In the largest comparable marketplace, the measured correlation between rating and actual usage ran from −0.15 to +0.07. It carries no information."],
  ["Win rate", "The dominant venue defines it as profitable days divided by days since first trade. An account up a dollar on ninety days and down fifty thousand on ten displays a ninety percent win rate."],
  ["Closed-position returns", "Hides the open book. Never closing a loser produces a flawless record."],
  ["Headline APY", "Boosted rates, locked emissions and pre-launch points are excluded. We quote the unboosted lower bound."],
  ["Follower counts, TVL, market cap", "Rentable, self-reinforcing, and unrelated to whether the agent works."],
  ["The indexer's composite score", "Ingested for comparison, never used for ranking. Its health score is non-monotonic against measured reachability: agents scored 15 answered 80% of the time, while agents scored 50 answered 24% of the time."],
];

export default async function Methodology() {
  const [agents, candReport] = await Promise.all([loadAgents(), loadCategoryCandidates()]);
  const f = funnel(agents);

  const defects: [string, string][] = [
    ["Single-region probing", "One vantage point. An agent that blocks our region or network appears dead. We cannot distinguish being down from being unreachable from here."],
    ["Sample, not census", `${f.sampled} of roughly ${POPULATION.callableUpperBound.toLocaleString()} callable agents, drawn from the newest registrations. Not random, so not representative of the middle of the distribution. A full registry census is in progress.`],
    ["One observation per agent", "A single transient failure counts as a failure here. Nothing is ever written on-chain from one observation."],
    ["Protocol overlap not deduplicated", `An agent declaring both MCP and A2A counts once per protocol in population figures, so ${POPULATION.callableUpperBound.toLocaleString()} is an upper bound.`],
    ["Counts drift", `Registration is continuous, at roughly ${POPULATION.newAgentsToday} new agents per day. Every figure is point-in-time, measured ${POPULATION.measuredAt}.`],
    ["Classification is evidence-gated", "A category is assigned only on specific evidence in the agent's own text - A2A card skills first, then registration description, then name - and the matched evidence is recorded on the agent. Registration files rarely declare machine-readable capability, so most agents cannot be classified at all; they are counted, not hidden. Loose matching inflated counts several times over during development and is pinned against by tests."],
  ];

  // Build tab content as variables to avoid parser issues with complex JSX in props
  const measuresTab = (
    <>
      {/* ── What is measured ────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <h2>What is measured</h2>
          <div className="data-table-frame mt-m">
            <div className="rows">
              <div className="rows-head" style={{ gridTemplateColumns: "11rem minmax(0,1.5fr) 9rem minmax(0,1.2fr)" }}>
                <span>Measure</span><span>Definition</span><span>Window</span><span>Known defect</span>
              </div>
              {MEASURES.map((m) => (
                <div key={m.name} className="row" style={{ gridTemplateColumns: "11rem minmax(0,1.5fr) 9rem minmax(0,1.2fr)" }}>
                  <div className="num sm">{m.name}</div>
                  <div className="sm t-2">{m.definition}</div>
                  <div className="xs t-4 num">{m.window}</div>
                  <div className="xs t-3">{m.defect}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );

  const refusedTab = (
    <>
      {/* ── What this registry refuses to show ─────────────────────── */}
      <section className="band">
        <div className="shell">
          <h2>What this registry refuses to show</h2>
          <div className="surface-card mt-m">
            <dl className="spec">
              {REFUSED.map(([k, v]) => (
                <div key={k} style={{ gridTemplateColumns: "16rem minmax(0,1fr)" }}>
                  <dt style={{ color: "var(--fg-2)" }}>{k}</dt>
                  <dd className="t-3">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  );

  const rankingTab = (
    <>
      {/* ── How ranking works ───────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <h2>How ranking works</h2>
          <p className="prose sm">
            Tiered rather than weighted, because a weighted score hides which input is doing
            the work and invites gaming of whichever one dominates.
          </p>
          <div className="surface-card mt-m">
            <div className="rows" style={{ borderTop: 0 }}>
              {[
                ["01", "Verified", "Completed a protocol handshake."],
                ["02", "Listed", "Responded, but did not speak the protocol."],
                ["03", "Dormant", "No usable response."],
                ["04", "Shadowed", "Fatal registration defect. Reachable by direct link, absent from discovery, never deleted."],
              ].map(([n, tier, desc]) => (
                <div key={n} className="row" style={{ gridTemplateColumns: "3.5rem 8rem minmax(0,1fr)" }}>
                  <div className="step-badge">{n}</div>
                  <div><h3>{tier}</h3></div>
                  <div className="sm t-3">{desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="notice mt-l">
            Within a tier, no operator may take more than <strong>three places</strong>.
            Concentration is the central finding here: {f.distinctOperators} operators account
            for all {f.sampled} agents audited, and the largest holds{" "}
            <strong>{f.topOperatorShare.toFixed(0)}%</strong> of them.
          </div>
        </div>
      </section>
    </>
  );

  const categoriesTab = (
    <>
      {/* ── How categories evolve ───────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <h2>How categories evolve</h2>
          <p className="prose sm">
            The four flagship jobs are fixed. Adjacent categories grow only by promotion: a
            detector runs daily over the unclassified corpus and nominates terms that appear in
            three or more distinct skills texts from at least two independent operators, and a
            person reads the agents behind a term before it becomes a rule. Automation proposes;
            promotion stays human, because the last four terms that cleared the bar on frequency
            alone were an operator name, two memecoin titles and the word &ldquo;not&rdquo;.
          </p>

          {!candReport.ok ? (
            <div className="notice mt-m" data-tone="fail">
              <strong>Could not read the candidate ledger.</strong> {candReport.reason ? `Reason: ${candReport.reason}.` : ""}{" "}
              An empty table and an unreadable one are different findings; this one was not measured.
            </div>
          ) : (
            <div className="surface-card mt-m">
              <dl className="spec">
                <div>
                  <dt>Unclassified agents</dt>
                  <dd className="num">{candReport.corpus!.unclassified.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>of those, declare skills</dt>
                  <dd className="num">{candReport.corpus!.withSkills.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>declare any capability text</dt>
                  <dd className="num">{candReport.corpus!.withAnyText.toLocaleString()}</dd>
                </div>
              </dl>
              <p className="xs t-4" style={{ margin: "10px 0 0" }}>
                The unclassified mass is not a matching failure to solve with a cleverer
                classifier: almost none of it publishes capability text to match. A name-only
                registration carries nothing to classify.
              </p>

              {candReport.candidates.length > 0 ? (
                <div className="data-table-frame mt-m">
                  <div className="rows">
                    <div className="rows-head" style={{ gridTemplateColumns: "minmax(0,1.2fr) 5rem 6rem 6rem minmax(0,1.4fr) 6rem" }}>
                      <span>Term</span><span>Texts</span><span>Verified</span><span>Operators</span><span>Examples</span><span>Last seen</span>
                    </div>
                    {candReport.candidates.map((c) => (
                      <div key={c.term} className="row" style={{ gridTemplateColumns: "minmax(0,1.2fr) 5rem 6rem 6rem minmax(0,1.4fr) 6rem" }}>
                        <div className="sm">{c.term} <span className="xs t-4">[{c.status}]</span></div>
                        <div className="num sm">{c.distinctTexts}</div>
                        <div className="num sm">{c.verifiedTexts}</div>
                        <div className="num sm">{c.distinctOperators}</div>
                        <div className="xs t-3">{c.exampleAgents.slice(0, 3).join(", ")}</div>
                        <div className="xs t-4 num">{c.lastSeenAt}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="sm t-3" style={{ margin: "14px 0 0" }}>
                  No term currently clears the nomination bar. That is the measured state of the
                  chain, not a gap in detection: agents matching no rule are overwhelmingly
                  registrations without usable capability text, not an unmet need waiting for a
                  tenth category.
                </p>
              )}
            </div>
          )}
          </div>
        </section>
      </>
  );

  const defectsTab = (
    <>
      {/* ── Defects in this dataset ────────────────────────────────── */}
      <section className="band band-last">
        <div className="shell">
          <h2>Defects in this dataset</h2>
          <div className="surface-card mt-m">
            <dl className="spec">
              {defects.map(([k, v]) => (
                <div key={k} style={{ gridTemplateColumns: "16rem minmax(0,1fr)" }}>
                  <dt style={{ color: "var(--fg-2)" }}>{k}</dt>
                  <dd className="t-3">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="xs t-4 mt-l">
            Liveness and audit figures are produced by this project. Reproduce with{" "}
            <span className="num">npx tsx scripts/funnel.ts</span>. Population counts come from
            the 8004scan public API, measured {POPULATION.measuredAt}.
          </p>
        </div>
      </section>
    </>
  );

  return (
    <>
      <section className="band">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Methodology</p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.7rem)" }}>
              Every number, and what is wrong with it.
            </h1>
            <p className="standfirst">
              A metric whose construction you cannot inspect is not evidence. So each measure
              is defined here alongside the ways it can mislead you.
            </p>
          </div>
        </div>
      </section>

      <MethodologyTabs
        measures={measuresTab}
        refused={refusedTab}
        ranking={rankingTab}
        categories={categoriesTab}
        defects={defectsTab}
      />
    </>
  );
}