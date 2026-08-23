import { notFound } from "next/navigation";
import { loadAgents, findAgent, trustState, classify, CATEGORIES } from "@/lib/data";
import { attestationsFor, attestationSummary } from "@/lib/attestations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OUTCOME_TONE: Record<string, string> = {
  succeeded: "pass",
  partial: "hold",
  failed: "fail",
  disputed: "fail",
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Renders a URL with unsubstituted template placeholders marked. */
function Uri({ url }: { url: string }) {
  return (
    <span className="uri">
      {url.split(/(\{[^}]*\})/g).map((part, i) =>
        /^\{[^}]*\}$/.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </span>
  );
}

export default async function AgentPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  const a = await findAgent(tokenId);
  if (!a) notFound();

  /**
   * Attestations, read independently of the agent record.
   *
   * allSettled rather than all: the evidence ledger is the least critical panel on
   * this page, and a failure there must not blank the agent card. That exact
   * coupling once blanked every counter on /live when a single malformed row threw.
   */
  const [attRes, sumRes] = await Promise.allSettled([
    attestationsFor(tokenId, 56, 12),
    attestationSummary(tokenId, 56),
  ]);
  const attestations = attRes.status === "fulfilled" ? attRes.value : [];
  const attSummary = sumRes.status === "fulfilled" ? sumRes.value : null;
  const evidenceUnavailable = attRes.status === "rejected";

  const st = trustState(a);
  const m = classify(a);
  const cat = m.category ? CATEGORIES[m.category] : null;
  const fatal = a.lint?.defects?.filter((d) => d.severity === "fatal") ?? [];
  const handshake = a.probe?.grade === "validated";

  return (
    <>
      {/* ── identity ─────────────────────────────────────────────── */}
      <section className="band-tight">
        <div className="shell">
          <p className="crumb">
            <a href="/">GEBO</a> <span className="t-4">/</span>{" "}
            {cat ? <a href={`/c/${cat.slug}`}>{cat.job}</a> : "Unclassified"}{" "}
            <span className="t-4">/</span> <span>#{a.token_id}</span>
          </p>
          <div className="inline-list" style={{ marginBottom: 12 }}>
            <h1 style={{ fontSize: "clamp(1.7rem, 3vw, 2.2rem)", margin: 0, maxWidth: "28ch" }}>
              {a.name ?? `Agent ${a.token_id}`}
            </h1>
            <span className="chip" data-state={st.state}>{st.state}</span>
            {a.x402 && <span className="chip chip-flat">x402</span>}
          </div>
          <p className="standfirst sm">{st.reason}</p>
          <div className="inline-list mt-m">
            <a href={`/a/${a.token_id}/hire`} className="cta">
              {fatal.length ? "Inspect authority scope" : "Authorise this agent"}
            </a>
            <span className="xs t-4">Nothing is signed. Scope, simulate, then review the grant.</span>
          </div>
        </div>
      </section>

      {/* ── fatal defects, before anything else ──────────────────── */}
      {fatal.length > 0 && (
        <section className="band-tight">
          <div className="shell">
            <div className="notice" data-tone="fail">
              <strong>This agent cannot be hired by any client.</strong>
              <div className="stack-sm" style={{ marginTop: 12 }}>
                {fatal.map((d, i) => (
                  <div key={i} className="inline-list">
                    <span className="chip" data-state="SHADOWED">{d.code}</span>
                    <span className="sm t-2">{d.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── liveness ─────────────────────────────────────────────── */}
      <section className="band-tight">
        <div className="shell">
          <p className="section-label">Liveness · measured by this registry</p>
          <dl className="kpi-grid">
            <div className="kpi-card">
              <dt style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="pulse-dot" data-status={handshake ? "pass" : "fail"} />
                Handshake
              </dt>
              <dd style={{ color: handshake ? "var(--pass)" : "var(--fail)" }}>
                {handshake ? "PASS" : "FAIL"}
              </dd>
              <div className="qualifier">
                {a.probe?.kind === "a2a"
                  ? "Agent card fetched, parsed, and checked against the A2A shape"
                  : a.probe?.kind === "mcp"
                    ? "JSON-RPC initialize sent, reply checked for a valid result"
                    : "Reachability only — no agent protocol asserted"}
              </div>
            </div>
            <div className="kpi-card">
              <dt>Round trip</dt>
              <dd>{a.probe?.rttMs != null ? `${a.probe.rttMs}` : "—"}
                {a.probe?.rttMs != null && <span className="t-4" style={{ fontSize: "0.8rem" }}> ms</span>}
              </dd>
              <div className="qualifier">One observation, one region. Not an average.</div>
            </div>
            <div className="kpi-card">
              <dt>Transport</dt>
              <dd style={{ fontSize: "1.25rem", letterSpacing: 0 }}>
                {a.probe?.httpStatus ?? "—"} <span className="t-4">{a.probe?.errClass}</span>
              </dd>
              <div className="qualifier">HTTP status and classified outcome</div>
            </div>
            <div className="kpi-card" data-empty="true">
              <dt>Uptime 7d</dt>
              <dd style={{ fontSize: "1.1rem" }}>Insufficient observations</dd>
              <div className="qualifier">n=1, floor=20. Shown once a real record exists.</div>
            </div>
          </dl>

          {a.probe?.evidence && (
            <div className="surface-card mt-m">
              <dl className="spec">
                {Object.entries(a.probe.evidence).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd className="mono">{v === null ? "—" : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </section>

      {/* ── authority ────────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <h2>What it could do to your wallet</h2>
          <div className="authority surface-card mt-m" data-risk="unknown" style={{ padding: 0, overflow: "hidden" }}>
            <div className="authority-head">No session registered in the keystore</div>
            <div className="authority-body" style={{ padding: "16px 24px 20px" }}>
              <dl className="spec">
                <div>
                  <dt>Authority</dt>
                  <dd>Not publicly verifiable. No registered session key exists, so no third party can check what this agent is permitted to do.</dd>
                </div>
                <div>
                  <dt>Interpretation</dt>
                  <dd>
                    Either it holds no delegated authority, or it holds authority granted
                    without registration — enforced on-chain but invisible to readers.
                    The absence of a session is <strong style={{ color: "var(--fg)" }}>not</strong>{" "}
                    evidence of safety.
                  </dd>
                </div>
                <div>
                  <dt>Worst case</dt>
                  <dd className="mono">unknown — declining to estimate</dd>
                </div>
              </dl>
            </div>
          </div>
          <p className="xs t-4 mt-m" style={{ maxWidth: "70ch" }}>
            Read directly from the Altana keystore at 0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a
            on BNB Smart Chain. These reads are permissionless and require no admin key.
          </p>
        </div>
      </section>

      {/* ── declarations ─────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <h2>What it declares</h2>
          <div className="surface-card mt-m">
            <dl className="spec">
              <div>
                <dt>Protocols</dt>
                <dd>{a.protocols.join(" · ") || <span className="t-4">none</span>}</dd>
              </div>
              <div>
                <dt>Endpoints</dt>
                <dd>
                  {a.endpoints.length === 0 ? (
                    <span className="t-4">none declared</span>
                  ) : (
                    <div className="stack-sm">
                      {a.endpoints.map((e, i) => (
                        <div key={i}>
                          <span className="chip chip-flat" style={{ marginRight: 8 }}>{e.kind}</span>
                          <Uri url={e.url} />
                        </div>
                      ))}
                    </div>
                  )}
                </dd>
              </div>
              {a.skills && a.skills.length > 0 && (
                <div>
                  <dt>Declared Skills</dt>
                  <dd style={{ minWidth: 0 }}>
                    <div className="stack-sm" style={{ gap: 6, maxWidth: "100%" }}>
                      {a.skills.map((s, idx) => {
                        const isWrite = /trade|swap|buy|sell|rebalance|liquidat|transfer|pay|order|execut/i.test(s);
                        return (
                          <div
                            key={idx}
                            className="chip chip-flat"
                            style={{
                              fontSize: 11.5,
                              lineHeight: 1.45,
                              padding: "6px 10px",
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 8,
                              maxWidth: "100%",
                              wordBreak: "break-word",
                              overflowWrap: "anywhere",
                              whiteSpace: "normal",
                            }}
                          >
                            <span
                              style={{
                                color: isWrite ? "var(--hold)" : "var(--pass)",
                                flexShrink: 0,
                                fontWeight: 650,
                                fontFamily: "var(--mono)",
                                fontSize: 10.5,
                                paddingTop: 1,
                              }}
                            >
                              {isWrite ? "● EXECUTE" : "● READ-ONLY"}
                            </span>
                            <span style={{ minWidth: 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>
                              {s}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </dd>
                </div>
              )}
              <div>
                <dt>Classification</dt>
                <dd>
                  {cat ? cat.job : <span className="t-4">unclassified</span>}
                  {m.matched.length > 0 && (
                    <span className="t-4"> · keyword heuristic: {m.matched.join(", ")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Registered</dt>
                <dd className="mono">
                  {new Date(a.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                </dd>
              </div>
              <div>
                <dt>Operator</dt>
                <dd className="mono">{a.operator?.registrableDomain ?? "—"}</dd>
              </div>
              <div>
                <dt>Endpoint host</dt>
                <dd className="mono">{a.operator?.host ?? "—"}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd className="mono">{a.owner_address}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ── indexer comparison ───────────────────────────────────── */}
      <section className={a.lint?.defects?.length ? "band" : "band band-last"}>
        <div className="shell">
          <p className="section-label">For comparison · what the indexer reports</p>
          <dl className="kpi-grid">
            <div className="kpi-card">
              <dt>health_score</dt>
              <dd>{a.scan.health_score ?? "—"}</dd>
              <div className="qualifier">Non-monotonic against measured reachability</div>
            </div>
            <div className="kpi-card">
              <dt>is_active</dt>
              <dd style={{ fontSize: "1.25rem", letterSpacing: 0, color: a.scan.is_active ? "var(--hold)" : "var(--fg-4)" }}>
                {String(a.scan.is_active)}
              </dd>
              <div className="qualifier">Self-declared in the registration file, unverified</div>
            </div>
            <div className="kpi-card">
              <dt>total_score</dt>
              <dd>{a.scan.total_score}</dd>
              <div className="qualifier">Their composite. We neither display nor rank on it.</div>
            </div>
            <div className="kpi-card">
              <dt>Reviews</dt>
              <dd>{a.scan.total_feedbacks}</dd>
              <div className="qualifier">Unfiltered aggregation is Sybil-vulnerable by design</div>
            </div>
          </dl>

          {a.scan.is_active === true && !handshake && (
            <div className="notice mt-l" data-tone="fail">
              This agent reports <strong>is_active: true</strong> and remains listed and
              discoverable, while our probe could not complete a handshake. Measuring health
              and acting on it are different things.
            </div>
          )}
        </div>
      </section>

      {/* ── full lint ────────────────────────────────────────────── */}
      {a.lint?.defects?.length > 0 && (
        <section className="band">
          <div className="shell">
            <h2>Registration audit</h2>
            <div className="data-table-frame mt-m">
              <div className="rows">
                <div className="rows-head" style={{ gridTemplateColumns: "6rem 11rem minmax(0,1fr)" }}>
                  <span>Severity</span><span>Code</span><span>Detail</span>
                </div>
                {a.lint.defects.map((d, i) => (
                  <div key={i} className="row" style={{ gridTemplateColumns: "6rem 11rem minmax(0,1fr)" }}>
                    <div>
                      <span className="chip" data-state={d.severity === "fatal" ? "SHADOWED" : d.severity === "major" ? "LISTED" : "DORMANT"}>
                        {d.severity}
                      </span>
                    </div>
                    <div className="num xs t-2">{d.code}</div>
                    <div className="sm t-3">{d.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
      {/* attestations: what this agent has actually been asked to do */}
      {/**
        * The evidence layer existed in the database for weeks and rendered nowhere,
        * so every task ever recorded against an agent was invisible to the person
        * deciding whether to hire it. That is the whole product failing quietly.
        *
        * There is no score here and there never will be. GPT Store data measured the
        * correlation between usage and rating at between -0.153 and +0.071, meaning
        * ratings carry no information. What is shown instead is what was asked, what
        * came back, and whether the evidence was verifiable - each row standing or
        * falling on its own.
        */}
      <section className="band band-last">
        <div className="shell">
          <div className="headline-pair">
            <h2>Track record</h2>
            <p className="prose sm">
              Tasks recorded against this agent, each anchored to evidence a third
              party can check. No stars, no score: a rating compresses away the only
              part that matters, which is what was asked and what came back.
            </p>
          </div>

          {evidenceUnavailable ? (
            <div className="notice mt-m" data-tone="fail">
              <strong>The evidence ledger could not be read.</strong> This is a failure
              to measure, not a finding that this agent has no track record.
            </div>
          ) : attestations.length === 0 ? (
            <div className="surface-card mt-m">
              <p className="prose sm" style={{ margin: 0 }}>
                No task has been recorded against this agent yet.
              </p>
              <div className="notice mt-m" data-tone="hold">
                <strong>That is not a criticism of the agent.</strong> It means nobody
                has hired it through a route we can verify. An attestation is stored
                only when it carries evidence &mdash; a session-key transaction, an
                ERC-8183 job, an x402 payment, or a task we ran ourselves &mdash;
                because a claim without evidence is an opinion, and opinions are what
                this registry exists to replace.
              </div>
            </div>
          ) : (
            <>
              {attSummary && (
                <dl className="kpi-grid mt-m">
                  <div className="kpi-card">
                    <dt>Tasks recorded</dt>
                    <dd>{attSummary.total}</dd>
                    <div className="qualifier">
                      {attSummary.verified} with evidence confirmed on chain or by us
                    </div>
                  </div>
                  <div className="kpi-card">
                    <dt>Completed as asked</dt>
                    <dd>
                      {attSummary.succeeded}
                      <span className="t-4" style={{ fontSize: "0.85rem" }}>
                        {" "}of {attSummary.total}
                      </span>
                    </dd>
                    <div className="qualifier">
                      Counted over every recorded task, failures included. A rate over a
                      handful of tasks describes those tasks and nothing wider
                    </div>
                  </div>
                </dl>
              )}

              <div className="data-table-frame mt-l">
                <div className="rows">
                  <div
                    className="rows-head"
                    style={{ gridTemplateColumns: "minmax(0,1.4fr) 7rem 7rem 6rem" }}
                  >
                    <span>Task and result</span>
                    <span>Outcome</span>
                    <span style={{ textAlign: "right" }}>Took</span>
                    <span>When</span>
                  </div>
                  {attestations.map((t) => (
                    <div
                      key={t.id}
                      className="row"
                      style={{ gridTemplateColumns: "minmax(0,1.4fr) 7rem 7rem 6rem" }}
                    >
                      <div>
                        <h3>{t.task ?? "(task not recorded)"}</h3>
                        {t.result && <div className="xs t-3">{t.result.slice(0, 180)}</div>}
                        <div className="xs t-4">
                          {t.evidenceKind}
                          {" \u00b7 "}
                          {t.evidenceVerified ? (
                            <span>evidence verified</span>
                          ) : (
                            <span style={{ color: "var(--fail)" }}>evidence unverified</span>
                          )}
                          {t.attesterTrusted && " \u00b7 trusted reviewer"}
                          {t.baselineDurationMs != null && (
                            <>
                              {" \u00b7 "}
                              <a href="/compare">compared against doing it by hand</a>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="xs">
                        <span
                          className="pulse-dot"
                          data-status={OUTCOME_TONE[t.outcome] ?? "hold"}
                        />{" "}
                        {t.outcome}
                      </div>
                      <div className="num xs t-3" style={{ textAlign: "right" }}>
                        {t.durationMs == null
                          ? "\u2014"
                          : t.durationMs < 1000
                            ? `${t.durationMs} ms`
                            : `${(t.durationMs / 1000).toFixed(1)}s`}
                      </div>
                      <div className="xs t-3">{ago(t.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {attSummary && attSummary.total < 5 && (
                <div className="notice mt-m" data-tone="hold">
                  <strong>
                    {attSummary.total} task{attSummary.total === 1 ? "" : "s"} is not a
                    record.
                  </strong>{" "}
                  Read the rows, not the ratio. A percentage over this few observations
                  would imply a reliability this evidence cannot support.
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
