import {
  loadAgents, funnel, POPULATION, CENSUS, CATEGORY_LIST, agentsByCategory, trustState,
} from "@/lib/data";

export const dynamic = "force-static";

/** Log scale, so a 269,726 → 345 collapse stays legible instead of vanishing. */
function logWidth(n: number, max: number) {
  if (n <= 0) return 0.6;
  return Math.max((Math.log10(n + 1) / Math.log10(max + 1)) * 100, 0.6);
}

export default async function Home() {
  const agents = await loadAgents();
  const f = funnel(agents);
  const byCat = agentsByCategory(agents);
  const top = CENSUS.tokensMinted;

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
      <section className="band">
        <div className="shell">
          <div className="headline-pair">
            <h1>270,200 agents. 362 you could actually hire.</h1>
            <p className="standfirst">
              GEBO reads every identity in the ERC-8004 registry on BNB Chain, audits what it
              declares, probes what it exposes, and shows exactly what it is permitted to do
              to your wallet before you authorise anything.
            </p>
          </div>
        </div>
      </section>

      {/* ── the collapse ─────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <p className="section-label">
            Registry census · {CENSUS.measuredAt} · {CENSUS.censused.toLocaleString()} identities read from chain
          </p>
          <div className="collapse">
            {steps.map((s) => (
              <div key={s.caption} className="collapse-step" data-terminal={s.terminal ? "true" : "false"}>
                <div>
                  <div className="collapse-figure" style={s.warn ? { color: "var(--hold)" } : undefined}>
                    {s.n.toLocaleString()}
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
      <section className="band">
        <div className="shell">
          <h2>228,421 owners. 70 operators.</h2>
          <p className="prose sm">
            Almost every identity belongs to a different wallet — {CENSUS.ownersWithOneAgent.toLocaleString()}{" "}
            addresses hold exactly one, and the ten largest owners together hold only{" "}
            {CENSUS.top10OwnerShare}%. So this is not a few accounts minting in bulk; it is a
            crowd registering one identity each. But only <strong>{CENSUS.operators}</strong>{" "}
            organisations actually run an endpoint, and the largest of them accounts for{" "}
            <strong>{CENSUS.largestOperatorShare}%</strong> of every endpoint on the chain.
            Rank by owner and you appear to have 228,421 suppliers. Rank by infrastructure and
            you have {CENSUS.operators}.
          </p>

          <dl className="readouts mt-m">
            <div className="readout">
              <dt>Distinct owners</dt>
              <dd>{(CENSUS.owners / 1000).toFixed(0)}k</dd>
              <div className="qualifier">Mean 1.2 agents each — no ownership concentration</div>
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

          {f.topOperators.length > 0 && (
            <div className="rows mt-l">
              <div className="rows-head r-operators">
                <span>Operator</span><span style={{ textAlign: "right" }}>Agents</span>
                <span style={{ textAlign: "right" }}>Answered</span><span>Assessment</span>
              </div>
              {f.topOperators.map((o) => {
                const dead = o.validated === 0;
                return (
                  <div key={o.key} className="row r-operators">
                    <div className="num sm">{o.label}</div>
                    <div className="num sm" style={{ textAlign: "right" }}>{o.count}</div>
                    <div className="num sm" style={{ textAlign: "right", color: dead ? "var(--fail)" : "var(--pass)" }}>
                      {o.validated}
                    </div>
                    <div className="xs t-3">
                      {dead
                        ? `none of ${o.count} completed a handshake`
                        : `${o.validated} of ${o.count} completed a handshake`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── four jobs ────────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <h2>Four jobs worth paying an agent to do</h2>
          <p className="prose sm">
            Named after the work, not the technology. Each surface indexes live chain state,
            so it holds real opportunities whether or not a competent agent exists yet.
          </p>

          <div className="rows mt-m">
            <div className="rows-head r-jobs">
              <span>Job</span><span>Verified</span><span>Venue</span>
            </div>
            {CATEGORY_LIST.map((c) => {
              const list = byCat.get(c.slug as never) ?? [];
              const verified = list.filter((a) => trustState(a).state === "VERIFIED").length;
              return (
                <a key={c.slug} href={`/c/${c.slug}`} className="row row-hover r-jobs">
                  <div>
                    <h3>{c.job}</h3>
                    <p className="xs t-3" style={{ margin: 0, maxWidth: "52ch" }}>{c.blurb}</p>
                  </div>
                  <div>
                    <span className="num" style={{ fontSize: "1.4rem", color: verified ? "var(--pass)" : "var(--fg-4)" }}>
                      {verified}
                    </span>
                    <span className="xs t-4 num" style={{ marginLeft: 7 }}>/ {list.length}</span>
                  </div>
                  <div className="sm t-3">{c.venue}</div>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── hiring model ─────────────────────────────────────────── */}
      <section className="band band-last">
        <div className="shell">
          <h2>What authorising an agent actually means</h2>
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
              <div key={title} className="row r-spec">
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
