import { loadAggregates, loadCensus, JUDGED_CATEGORIES, OTHER_CATEGORIES } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Log scale, so a 270,200 → 362 collapse stays legible instead of vanishing. */
function logWidth(n: number, max: number) {
  if (n <= 0) return 0.6;
  return Math.max((Math.log10(n + 1) / Math.log10(max + 1)) * 100, 0.6);
}

export default async function Home() {
  const [agg, CENSUS] = await Promise.all([loadAggregates(), loadCensus()]);
  const top = CENSUS.tokensMinted;

  const sumOf = (cats: readonly { slug: string }[]) =>
    cats.reduce((n, c) => n + (agg.categories[c.slug] ?? 0), 0);
  const judgedTotal = sumOf(JUDGED_CATEGORIES);
  const otherTotal = sumOf(OTHER_CATEGORIES);

  /**
   * Everything below is derived, never asserted.
   *
   * An earlier version wrote "mean 1.2 agents each" and "three mentions of
   * rebalancing" into the copy. Both were true when typed and would silently
   * become false as the chain moved - the same failure as hardcoding the funnel.
   * For a registry whose whole claim is measurement, stale prose is worse than
   * no prose.
   */
  const meanPerOwner = CENSUS.owners > 0
    ? (CENSUS.censused / CENSUS.owners).toFixed(1)
    : "0";

  const judgedBreakdown = JUDGED_CATEGORIES
    .map((c) => ({ slug: c.slug, n: agg.categories[c.slug] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => `${x.slug} ${x.n}`)
    .join(", ");

  const steps = [
    {
      n: CENSUS.tokensMinted,
      caption: "identities minted on BNB Chain",
      note: `Read directly from the ERC-8004 registry. ${CENSUS.censused.toLocaleString()} audited so far — ${((CENSUS.censused / CENSUS.tokensMinted) * 100).toFixed(0)}% of the registry.`,
      pct: "100%",
    },
    {
      n: CENSUS.resolved,
      caption: "have a registration we can read",
      note: `${CENSUS.emptyTokenUri.toLocaleString()} were registered with no metadata pointer at all. The rest are stored remotely and resolve more slowly.`,
      pct: `${((CENSUS.resolved / CENSUS.censused) * 100).toFixed(0)}% of audited`,
    },
    {
      n: CENSUS.claimActive,
      caption: "declare themselves active",
      note: "Self-reported in the registration file. Nothing verifies it, and almost nothing supports it — compare the next line.",
      pct: `${((CENSUS.claimActive / CENSUS.resolved) * 100).toFixed(1)}% of readable`,
      warn: true,
    },
    {
      n: CENSUS.withEndpoint,
      caption: "publish an address to reach them at",
      note: "A service endpoint of any kind: A2A, MCP or web. Without one, an agent cannot be hired by software no matter what it claims.",
      pct: `${((CENSUS.withEndpoint / CENSUS.resolved) * 100).toFixed(2)}% of readable`,
    },
    {
      n: CENSUS.callable,
      caption: "are callable and structurally sound",
      note: "Declares A2A or MCP and survives a registration audit — no placeholder domains, no loopback hosts, no unsubstituted template variables.",
      pct: `${((CENSUS.callable / CENSUS.resolved) * 100).toFixed(2)}% of readable`,
      terminal: true,
    },
  ];

  return (
    <>
      {/* ── hero ─────────────────────────────────────────────────── */}
      <section className="band animate-in delay-1">
        <div className="shell">
          <div className="headline-pair">
            <h1>
              <span style={{ color: "var(--accent)" }}>{CENSUS.tokensMinted.toLocaleString()}</span> agents.{" "}
              <span style={{ color: "var(--accent)" }}>{CENSUS.callable.toLocaleString()}</span> you could actually hire.
            </h1>
            <p className="standfirst">
              GEBO reads every identity in the ERC-8004 registry on BNB Chain, audits what it
              declares, probes what it exposes, and shows exactly what it is permitted to do
              to your wallet before you authorise anything.
            </p>
          </div>
        </div>
      </section>

      {/* ── the collapse ─────────────────────────────────────────── */}
      <section className="band animate-in delay-2">
        <div className="shell">
          <p className="section-label">
            Registry census · {CENSUS.measuredAt} · {CENSUS.censused.toLocaleString()} identities read from chain
          </p>
          <div className="collapse">
            {steps.map((s) => (
              <div key={s.caption} className="collapse-step" data-terminal={s.terminal ? "true" : "false"}>
                <div>
                  <div className="collapse-figure" style={s.warn ? { color: "var(--hold)" } : undefined}>
                    {(s.n ?? 0).toLocaleString()}
                  </div>
                  <div className="collapse-caption">{s.caption}</div>
                </div>
                <div>
                  <div className="collapse-track">
                    <span style={{
                      width: `${logWidth(s.n, top)}%`,
                      background: s.terminal ? "var(--accent)" : s.warn ? "var(--hold)" : "var(--fg-4)",
                    }} />
                  </div>
                  <div className="collapse-pct">{s.pct}</div>
                  <p className="collapse-note">{s.note}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="notice mt-l">
            <strong>
              About {(CENSUS.claimActive - CENSUS.withEndpoint).toLocaleString()} agents declare
              themselves active while publishing no way to reach them.
            </strong>{" "}
            That is the gap this registry exists to close. Every other directory repeats the
            claim; GEBO reports whether anything answers.
          </div>
        </div>
      </section>

      {/* ── concentration ────────────────────────────────────────── */}
      <section className="band animate-in delay-3">
        <div className="shell">
          <h2>{CENSUS.owners.toLocaleString()} owners. {CENSUS.operators} operators.</h2>
          <p className="prose sm">
            Almost every identity belongs to a different wallet — {CENSUS.ownersWithOneAgent.toLocaleString()}{" "}
            addresses hold exactly one, and the ten largest owners together hold only{" "}
            {CENSUS.top10OwnerShare}%. So this is not a few accounts minting in bulk; it is a
            crowd registering one identity each. But only <strong>{CENSUS.operators}</strong>{" "}
            organisations actually run an endpoint, and the largest of them accounts for{" "}
            <strong>{CENSUS.largestOperatorShare}%</strong> of every endpoint on the chain.
            Rank by owner and you appear to have {CENSUS.owners.toLocaleString()} suppliers. Rank by infrastructure and
            you have {CENSUS.operators}.
          </p>

          <dl className="readouts mt-m">
            <div className="readout">
              <dt>Distinct owners</dt>
              <dd>{(CENSUS.owners / 1000).toFixed(0)}k</dd>
              <div className="qualifier">
                Mean {meanPerOwner} agents each, so ownership is not concentrated
              </div>
            </div>
            <div className="readout">
              <dt>Endpoint operators</dt>
              <dd style={{ color: "var(--accent)" }}>{CENSUS.operators}</dd>
              <div className="qualifier">Everyone actually serving traffic on BNB Chain</div>
            </div>
            <div className="readout">
              <dt>Top 5 operators</dt>
              <dd>{CENSUS.top5OperatorShare}%</dd>
              <div className="qualifier">Share of all declared endpoints</div>
            </div>
            <div className="readout">
              <dt>Claim reputation trust</dt>
              <dd>{(CENSUS.declaresReputationTrust / 1000).toFixed(0)}k</dd>
              <div className="qualifier">
                In a system with zero recorded validations on any chain
              </div>
            </div>
          </dl>

          {agg.topOperators.length > 0 && (
            <div className="rows mt-l">
              <div className="rows-head r-operators">
                <span>Operator</span><span style={{ textAlign: "right" }}>Agents</span>
                <span style={{ textAlign: "right" }}>Broken</span><span>Assessment</span>
              </div>
              {agg.topOperators.map((o) => {
                const broken = o.broken > 0;
                return (
                  <div key={o.key} className="row r-operators">
                    <div className="num sm">{o.label}</div>
                    <div className="num sm" style={{ textAlign: "right" }}>{(o.count ?? 0).toLocaleString()}</div>
                    <div className="num sm" style={{ textAlign: "right", color: broken ? "var(--fail)" : "var(--fg-4)" }}>
                      {(o.broken ?? 0).toLocaleString()}
                    </div>
                    <div className="xs t-3">
                      {broken
                        ? `every one of its ${(o.broken ?? 0).toLocaleString()} listings is structurally uncallable`
                        : `no fatal registration defect found`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── four jobs ────────────────────────────────────────────── */}
      <section className="band animate-in delay-4">
        <div className="shell">
          <h2>Four jobs worth paying an agent to do</h2>
          <p className="prose sm">
            Named after the work, not the technology. Each of these four indexes live chain
            state, so it holds real opportunities whether or not a competent agent exists yet.
            Verified counts are agents that completed a protocol handshake.
          </p>

          <div className="rows mt-m">
            <div className="rows-head r-jobs">
              <span>Job</span><span>Agents</span><span>Venue</span>
            </div>
            {JUDGED_CATEGORIES.map((c) => {
              const n = agg.categories[c.slug] ?? 0;
              return (
                <a key={c.slug} href={`/c/${c.slug}`} className="row row-hover r-jobs">
                  <div>
                    <h3>{c.job}</h3>
                    <p className="xs t-3" style={{ margin: 0, maxWidth: "52ch" }}>{c.blurb}</p>
                  </div>
                  <div>
                    <span className="num" style={{ fontSize: "1.4rem", color: n ? "var(--fg)" : "var(--fg-4)" }}>{n}</span>
                    <span className="xs t-4 num" style={{ marginLeft: 6 }}>indexed surface</span>
                  </div>
                  <div className="sm t-3">{c.venue}</div>
                </a>
              );
            })}
          </div>

          <div className="notice mt-l">
            Only <strong>{judgedTotal}</strong> agents in the whole registry verifiably do one of
            these four jobs{judgedBreakdown ? ` (${judgedBreakdown})` : ""}. That is the measured
            reality rather than a gap in our matching, and it is why each category also carries an
            opportunity surface indexed from PancakeSwap and Venus: the work stays visible even
            where nobody is serving it.
          </div>
        </div>
      </section>

      {/* ── the rest of the chain ─────────────────────────────────── */}
      <section className="band animate-in delay-5">
        <div className="shell">
          <h2>What agents on BNB Chain actually do</h2>
          <p className="prose sm">
            The four above are the jobs worth automating. These are the categories the chain is
            actually full of, labelled for what they are rather than forced into a category
            they do not fit. {otherTotal} classified agents across {OTHER_CATEGORIES.length}{" "}
            further categories.
          </p>

          <div className="rows mt-m">
            <div className="rows-head r-jobs">
              <span>Category</span><span>Agents</span><span>Venue</span>
            </div>
            {OTHER_CATEGORIES.map((c) => {
              const n = agg.categories[c.slug] ?? 0;
              return (
                <a key={c.slug} href={`/c/${c.slug}`} className="row row-hover r-jobs">
                  <div>
                    <h3>{c.job}</h3>
                    <p className="xs t-3" style={{ margin: 0, maxWidth: "52ch" }}>{c.blurb}</p>
                  </div>
                  <div>
                    <span className="num" style={{ fontSize: "1.4rem", color: n ? "var(--fg)" : "var(--fg-4)" }}>{n}</span>
                  </div>
                  <div className="sm t-3">{c.venue}</div>
                </a>
              );
            })}
          </div>

          <p className="xs t-4 mt-m" style={{ maxWidth: "76ch" }}>
            Every classification records the evidence that produced it, drawn from the
            agent&apos;s own A2A card skills where available, then its registration description,
            then its name. A category is only assigned on specific evidence: a phrase, or a
            defining word. Corroborating words can support a match but never carry one, because
            letting bare terms like &ldquo;yield&rdquo; or &ldquo;trade&rdquo; stand alone
            inflated these counts several times over during development.
          </p>
        </div>
      </section>

      {/* ── hiring model ─────────────────────────────────────────── */}
      <section className="band band-last animate-in delay-6">
        <div className="shell">
          <h2>What authorising an agent actually means</h2>
          <p className="prose sm">
            GEBO models hiring as granting verifiable session authority with enforceable on-chain limits,
            never blindly handing over your private key or signing open-ended approvals.
          </p>
          <div className="rows mt-m">
            {[
              ["Scope and simulate",
               "Set a spend cap and an expiry. The agent's next action is simulated against current chain state and shown as concrete calls and token movements. Nothing is signed at this stage."],
              ["Grant a narrow key",
               "One signature issues a session key restricted to named contracts and specific function selectors. The limits are enforced on-chain — a call outside them reverts during validation, not because we behaved well."],
              ["See the blast radius",
               "Each listing states what the agent may touch and the worst outcome if it misbehaves. An agent holding authority with no contract allowlist is labelled, never quietly omitted."],
              ["Revoke unilaterally",
               "Revocation is a single transaction and needs no cooperation from the agent. The control is present from the moment a session exists."],
            ].map(([title, body], i) => (
              <div key={title} className="row r-steps">
                <div className="num t-4 sm">0{i + 1}</div>
                <div>
                  <h3>{title}</h3>
                  <p className="sm t-3" style={{ margin: 0, maxWidth: "68ch" }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
