import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { loadAgents, findAgent, trustState, classify, CATEGORIES } from "@/lib/data";
import { attestationsFor, attestationSummary, taskRuns, type Outcome } from "@/lib/attestations";
import { agentMetrics, type MetricValue } from "@/lib/metrics";
import { fetchSampleOutput } from "@/lib/sample-output";
import { probeHistoryFor, type ProbeHistory } from "@/lib/probe-history";
import { reviewsFor, type Review } from "@/lib/reviews";
import AgentTabs from "./AgentTabs";
import { ReviewForm } from "./ReviewForm";
import ShortlistButton from "./ShortlistButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ tokenId: string }> }): Promise<Metadata> {
  const { tokenId } = await params;
  const agent = await findAgent(tokenId);
  return { title: agent?.name ? `${agent.name} — agent — GEBO` : `Agent #${tokenId} — GEBO` };
}

/** Tone per attestation outcome - keyed by the union, so an unknown outcome is a type error, not a silent miss. */
const OUTCOME_TONE: Record<Outcome, string> = {
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
  const [attRes, sumRes, metRes, sampleRes, probeRes, runsRes, revRes] = await Promise.allSettled([
    attestationsFor(tokenId, 56, 12),
    attestationSummary(tokenId, 56),
    agentMetrics(56, tokenId),
    fetchSampleOutput(a),
    probeHistoryFor(tokenId, 56),
    taskRuns(56, 50, tokenId),
    reviewsFor(tokenId, 20),
  ]);
  const attestations = attRes.status === "fulfilled" ? attRes.value : [];
  const attSummary = sumRes.status === "fulfilled" ? sumRes.value : null;
  const evidenceUnavailable = attRes.status === "rejected";
  const metrics: MetricValue[] = metRes.status === "fulfilled" ? metRes.value : [];
  const byMetric = new Map(metrics.map((mv) => [mv.metricId, mv]));
  const sampleOutput = sampleRes.status === "fulfilled" ? sampleRes.value : null;
  const probeHistory: ProbeHistory | null = probeRes.status === "fulfilled" ? probeRes.value : null;
  const advantageRuns = runsRes.status === "fulfilled" ? runsRes.value : null;
  const reviews: { reviews: Review[]; unavailable: boolean } = revRes.status === "fulfilled"
    ? revRes.value
    : { reviews: [], unavailable: true };

  const st = trustState(a);
  const m = classify(a);
  const cat = m.category ? CATEGORIES[m.category] : null;
  const fatal = a.lint?.defects?.filter((d) => d.severity === "fatal") ?? [];
  const handshake = a.probe?.grade === "validated";
  /**
   * Provenance disclosure, not a badge of honour. The four reference agents
   * (HealthGuard, RangeKeeper, GridRunner, YieldRouter) run on GEBO's own
   * deployment, and a visitor deciding who to hire is owed that fact plainly -
   * they are probed and graded like anyone else, never privileged.
   *
   * NO HARDCODED DOMAIN, by design: an agent counts as GEBO-operated when its
   * endpoint runs on a host this deployment itself answers on - the request's
   * own host, plus the canonical hosts from env. A custom domain keeps the
   * disclosure working from the day the on-chain URIs are re-registered, and
   * nothing in code ever names a domain.
   */
  const requestHost = (await headers()).get("host")?.split(":")[0] ?? null;
  const ownHosts = new Set<string>(
    [
      requestHost,
      process.env.NEXT_PUBLIC_SITE_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_URL,
    ]
      .filter((u): u is string => !!u)
      .flatMap((u) => {
        try {
          return [new URL(u.startsWith("http") ? u : `https://${u}`).hostname];
        } catch {
          return [];
        }
      }),
  );
  const hostOf = (u: string): string | null => {
    try { return new URL(u).hostname; } catch { return null; }
  };
  const geboOperated = (a.endpoints ?? []).some((e) => {
    const h = hostOf(e.url);
    return h !== null && ownHosts.has(h);
  });

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
            {geboOperated && <span className="chip chip-flat">Operated by GEBO</span>}
          </div>
          <p className="standfirst sm">{st.reason}</p>

          {geboOperated && (
            <p className="xs t-4" style={{ marginBottom: 12 }}>
              GEBO operates this agent itself, as a working reference for the category.
              It answers from live chain state, is probed and graded on the same terms as
              every other agent, and holds no privileged place in these rankings.
            </p>
          )}

          {/* Plain-English summary for non-technical users */}
          <div className="surface-card mt-m" style={{ borderLeft: "3px solid var(--accent)", padding: "14px 18px" }}>
            <p className="sm" style={{ margin: 0, color: "var(--fg-2)" }}>
              {cat ? (
                <>
                  <strong>What this agent does:</strong> It helps with{" "}
                  <strong>{cat.job.toLowerCase()}</strong> on BNB Smart Chain.
                  {handshake
                    ? " It is currently online and reachable."
                    : " It could not be reached at our last check."}
                  {st.state === "VERIFIED"
                    ? " We have verified its identity against the on-chain registry."
                    : ""}
                </>
              ) : (
                <>
                  <strong>What this agent does:</strong> This agent is registered on BNB Smart Chain
                  but has not been classified into a specific category yet.
                  {handshake
                    ? " It is currently online and reachable."
                    : " It could not be reached at our last check."}
                </>
              )}
            </p>
            {a.description && (
              <p className="xs t-4 mt-s" style={{ margin: 0, maxWidth: "70ch" }}>
                {a.description.slice(0, 200)}{a.description.length > 200 ? "..." : ""}
              </p>
            )}
          </div>

          <div className="inline-list mt-m">
            <a href={`/a/${a.token_id}/hire`} className="cta">
              {fatal.length ? "View safety details" : "Try this agent"}
            </a>
            {/* The comparison entry point: accumulates this agent into the
                visitor's shortlist and opens the side-by-side view. */}
            <ShortlistButton tokenId={a.token_id} />
            <span className="xs t-4">Review what it can do, then decide. Nothing is signed until you approve.</span>
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

      {/* ── tabbed content: liveness + sample / authority / registration / track record ── */}
      <AgentTabs
        overview={
          <>
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
              <div className="qualifier">Latest probe only. One observation, one region. Not an average.</div>
            </div>
            {(() => {
              const p50 = byMetric.get("latency_p50_7d");
              return p50 ? (
                <div className="kpi-card">
                  <dt>Response time p50, 7d</dt>
                  <dd>{p50.value}<span className="t-4" style={{ fontSize: "0.8rem" }}> ms</span></dd>
                  <div className="qualifier">
                    n={p50.qualifiers.obsCount} probes. {p50.qualifiers.knownDefects[0]}
                  </div>
                </div>
              ) : (
                <div className="kpi-card" data-empty="true">
                  <dt>Response time p50, 7d</dt>
                  <dd style={{ fontSize: "1.1rem" }}>Insufficient observations</dd>
                  <div className="qualifier">Shown once 20 probes accumulate in the window.</div>
                </div>
              );
            })()}
            <div className="kpi-card">
              <dt>Transport</dt>
              <dd style={{ fontSize: "1.25rem", letterSpacing: 0 }}>
                {a.probe?.httpStatus ?? "—"} <span className="t-4">{a.probe?.errClass}</span>
              </dd>
              <div className="qualifier">HTTP status and classified outcome</div>
            </div>
            {(() => {
              const up = byMetric.get("uptime_7d");
              return up ? (
                <div className="kpi-card">
                  <dt>Uptime 7d</dt>
                  <dd style={{ color: "var(--pass)" }}>{up.value}%</dd>
                  <div className="qualifier">
                    n={up.qualifiers.obsCount} probes over 7 days.{" "}
                    <a href="/methodology">How this is measured, and how it can mislead</a>
                  </div>
                </div>
              ) : (
                <div className="kpi-card" data-empty="true">
                  <dt>Uptime 7d</dt>
                  <dd style={{ fontSize: "1.1rem" }}>Insufficient observations</dd>
                  <div className="qualifier">
                    No percentage is shown until 20 probes accumulate in the window. A
                    percentage from fewer would imply a reliability this evidence cannot support.
                  </div>
                </div>
              );
            })()}
          </dl>

          {a.probe?.evidence && (() => {
            /**
             * The probe's evidence object, translated. The old view dumped
             * Object.entries raw: "hasCapabilities", a skills array stringified
             * into one comma blob, a 1200-char description in a mono cell. Keys
             * this renderer does not know still appear, raw, at the bottom -
             * translating is not filtering.
             */
            const ev: Record<string, unknown> = a.probe.evidence;
            const str = (k: string): string | null =>
              ev[k] == null || ev[k] === "" ? null : String(ev[k]);
            const KNOWN = new Set([
              "name", "description", "skillCount", "skills",
              "hasCapabilities", "hasUrl", "hasVersion", "version",
              "declaredEndpoint", "endpointDefect",
            ]);
            const skills = Array.isArray(ev.skills) ? (ev.skills as unknown[]).map((s) => String(s)) : [];
            const skillCount = typeof ev.skillCount === "number" ? ev.skillCount : skills.length;
            const present: string[] = [];
            const missing: string[] = [];
            (str("name") ? present : missing).push("name");
            (skills.length > 0 || ev.skillCount != null ? present : missing).push("skills");
            const boolChecks: [string, string][] = [
              ["hasCapabilities", "capabilities"],
              ["hasUrl", "url"],
              ["hasVersion", "version"],
            ];
            for (const [k, label] of boolChecks) (ev[k] ? present : missing).push(label);
            const endpoint = str("declaredEndpoint");
            const defect = str("endpointDefect");
            const rest = Object.entries(ev)
              .filter(([k]) => !KNOWN.has(k))
              .sort(([a], [b]) => a.localeCompare(b));
            return (
              <div className="surface-card mt-m">
                <p className="section-label" style={{ marginBottom: 10 }}>
                  What the last probe saw on the wire
                </p>
                <dl className="spec">
                  {str("name") && (
                    <div><dt>Card name</dt><dd>{str("name")}</dd></div>
                  )}
                  {str("version") && (
                    <div><dt>Card version</dt><dd className="mono">{str("version")}</dd></div>
                  )}
                  <div>
                    <dt>A2A card structure</dt>
                    <dd>
                      Has {present.length ? present.join(", ") : "none of the expected fields"}
                      {missing.length > 0 && `; missing ${missing.join(", ")}`}
                      <div className="note">structural checks the probe ran on the card JSON</div>
                    </dd>
                  </div>
                  {endpoint && (
                    <div>
                      <dt>Declared endpoint</dt>
                      <dd>
                        <Uri url={endpoint} />
                        {defect && (
                          <div className="note" style={{ color: "var(--fail)" }}>
                            unusable: {defect}
                          </div>
                        )}
                      </dd>
                    </div>
                  )}
                  {(skills.length > 0 || ev.skillCount != null) && (
                    <div>
                      <dt>Skills declared</dt>
                      <dd>
                        {skillCount > 0 ? `${skillCount} skill${skillCount === 1 ? "" : "s"}` : "none"}
                        {skills.length > 0 && (
                          <div className="inline-list" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            {skills.slice(0, 12).map((s, i) => (
                              <span key={i} className="chip chip-flat">{s}</span>
                            ))}
                            {skills.length > 12 && (
                              <span className="xs t-4">+{skills.length - 12} more</span>
                            )}
                          </div>
                        )}
                      </dd>
                    </div>
                  )}
                  {str("description") && (
                    <div>
                      <dt>Self-description</dt>
                      <dd>
                        {str("description")}
                        <div className="note">the agent&apos;s own words, as the probe recorded them</div>
                      </dd>
                    </div>
                  )}
                </dl>
                {rest.length > 0 && (
                  <>
                    <p className="section-label" style={{ margin: "18px 0 0" }}>Other recorded fields</p>
                    <dl className="spec">
                      {rest.map(([k, v]) => (
                        <div key={k}>
                          <dt className="mono">{k}</dt>
                          <dd className="mono">
                            {v === null || v === undefined
                              ? "—"
                              : typeof v === "object"
                                ? JSON.stringify(v)
                                : String(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </section>

      {/* ── sample output ────────────────────────────────────────── */}
      {sampleOutput && (
        <section className="band-tight">
          <div className="shell">
            <p className="section-label">What you would get · live from the agent</p>
            <div className="surface-card mt-m" style={{ borderLeft: "3px solid var(--accent)", padding: "14px 18px" }}>
              <div className="xs t-4" style={{ marginBottom: 6, color: "var(--fg-3)" }}>
                Sample query sent to this agent&apos;s endpoint:
              </div>
              <p className="sm" style={{ margin: 0, fontStyle: "italic", color: "var(--fg-2)", maxWidth: "70ch" }}>
                {sampleOutput.query}
              </p>
              {sampleOutput.response ? (
                <>
                  <div className="xs t-4" style={{ marginTop: 12, marginBottom: 6, color: "var(--fg-3)" }}>
                    Agent replied in {sampleOutput.latencyMs}ms:
                  </div>
                  <pre className="sm" style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--mono)", fontSize: "0.85rem", lineHeight: 1.5, color: "var(--fg)" }}>
                    {sampleOutput.response}
                  </pre>
                </>
              ) : (
                <div className="xs t-4" style={{ marginTop: 8, color: "var(--fail)" }}>
                  {sampleOutput.error ?? "No response recorded"}
                  {sampleOutput.latencyMs != null && ` (${sampleOutput.latencyMs}ms)`}
                </div>
              )}
            </div>
            <p className="xs t-4 mt-s">
              This is a real query sent to the agent&apos;s live endpoint. The response is unedited.
              <a href={`/a/${a.token_id}/hire`} style={{ marginLeft: 6 }}>Run the full simulation →</a>
            </p>
          </div>
        </section>
      )}

          </>
        }
        authority={
          <>
      {/* ── authority ────────────────────────────────────────────── */}
      <section className="band band-last">
        <div className="shell">
          <h2>What it could do to your wallet</h2>
          <div className="authority surface-card mt-m" data-risk="unknown" style={{ padding: 0, overflow: "hidden" }}>
            <div className="authority-head">No session registered in the keystore</div>
            <div className="authority-body" style={{ padding: "16px 24px 20px" }}>
              <dl className="spec">
                <div>
                  <dt>In plain English</dt>
                  <dd>
                    This agent has not been granted any spending authority through the Altana
                    session system. That means either it operates without touching your wallet,
                    or it uses a different permission system we cannot see from here.
                  </dd>
                </div>
                <div>
                  <dt>What this means for you</dt>
                  <dd>
                    You can still hire this agent through APEX escrow (a neutral third-party
                    smart contract on BNB Chain). The escrow holds funds until the job is
                    completed, and you can dispute if the result is not satisfactory.
                  </dd>
                </div>
                <div>
                  <dt>How to verify</dt>
                  <dd className="mono" style={{ fontSize: "0.85rem" }}>
                    Read directly from the Altana keystore at 0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a
                    on BNB Smart Chain. These reads are permissionless and require no admin key.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>
          </>
        }
        registration={
          <>
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
                <div className="rows-head r-lint">
                  <span>Severity</span><span>Code</span><span>Detail</span>
                </div>
                {a.lint.defects.map((d, i) => (
                  <div key={i} className="row r-lint">
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
          </>
        }
        trackRecord={
          <>
      {/* ── track record: attestations + probe history ──────────────── */}
      <section className="band band-last">
        <div className="shell">
          <div className="headline-pair">
            <h2>Track record</h2>
            <p className="prose sm">
              Every row is anchored to evidence a third party can check. Manual
              tasks show what was asked and what came back. Probe history shows
              every time we checked whether this agent answers.
            </p>
          </div>

          {/* KPI summary — show whichever data we have */}
          {(attestations.length > 0 || probeHistory) && (
            <dl className="kpi-grid mt-m">
              {attestations.length > 0 && attSummary && (
                <>
                  <div className="kpi-card">
                    <dt>Tasks recorded</dt>
                    <dd>{attSummary.total}</dd>
                    <div className="qualifier">
                      {attSummary.verified} with evidence confirmed
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
                      Failures included at full weight
                    </div>
                  </div>
                </>
              )}
              {probeHistory && (
                <>
                  <div className="kpi-card">
                    <dt>Probes (14d)</dt>
                    <dd>{probeHistory.totalProbes.toLocaleString()}</dd>
                    <div className="qualifier">
                      Every probe is an independent check
                    </div>
                  </div>
                  <div className="kpi-card">
                    <dt>Uptime</dt>
                    <dd style={{ color: (probeHistory.overallUptime ?? 0) >= 99 ? "var(--pass)" : (probeHistory.overallUptime ?? 0) >= 90 ? "var(--hold)" : "var(--fail)" }}>
                      {probeHistory.overallUptime != null ? `${probeHistory.overallUptime}%` : "\u2014"}
                    </dd>
                    <div className="qualifier">
                      Probes that received a valid response
                    </div>
                  </div>
                  {probeHistory.avgP50 != null && (
                    <div className="kpi-card">
                      <dt>Avg response</dt>
                      <dd>{probeHistory.avgP50} ms</dd>
                      <div className="qualifier">
                        Mean p50 across observed days
                      </div>
                    </div>
                  )}
                </>
              )}
            </dl>
          )}

          {/* Trading record: replay-measured strategy economics for the grid
              agent. Rendered only when the replay metrics exist; a missing
              win rate renders as an explicit absence, never a zero. */}
          {(() => {
            const wr30 = byMetric.get("grid_win_rate_30d");
            const wr7 = byMetric.get("grid_win_rate_7d");
            const edge30 = byMetric.get("grid_edge_vs_hold_30d");
            const edge7 = byMetric.get("grid_edge_vs_hold_7d");
            const dd30 = byMetric.get("grid_max_drawdown_30d");
            const dd7 = byMetric.get("grid_max_drawdown_7d");
            if (!wr30 && !wr7 && !edge30 && !edge7 && !dd30 && !dd7) return null;
            const q = edge30?.qualifiers ?? edge7?.qualifiers ?? wr30?.qualifiers ?? null;
            const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
            return (
              <div className="surface-card mt-m" style={{ padding: "16px 18px", borderLeft: "3px solid var(--accent)" }}>
                <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Trading record &mdash; its advised strategy, replayed over the market that happened</h3>
                <p className="xs t-4" style={{ margin: "0 0 12px" }}>
                  The agent advises a mechanical grid; the market graded it. The venue is a
                  PancakeSwap V3 pool picked by the agent&apos;s own depth rule, and every leg
                  pays that pool&apos;s fee tier. For a liquidity provider, edge vs DIY is the
                  measured value of actively re-ranging this position over leaving the same
                  capital parked in it. Win rate is over closed round-trips only; edge is net
                  of the pool&apos;s fees, against both doing-nothing and holding the traded
                  asset.
                </p>
                <dl className="kpi-grid" style={{ marginTop: 0 }}>
                  {wr30 && (
                    <div className="kpi-card">
                      <dt>Win rate, 30d</dt>
                      <dd>{wr30.value.toFixed(1)}%</dd>
                      <div className="qualifier">{wr30.qualifiers.formula}</div>
                    </div>
                  )}
                  {!wr30 && wr7 && (
                    <div className="kpi-card">
                      <dt>Win rate, 7d</dt>
                      <dd>{wr7.value.toFixed(1)}%</dd>
                      <div className="qualifier">{wr7.qualifiers.formula}</div>
                    </div>
                  )}
                  {!wr30 && !wr7 && (
                    <div className="kpi-card">
                      <dt>Win rate</dt>
                      <dd>&mdash;</dd>
                      <div className="qualifier">No round-trip closed in the window; a rate would be invented, not measured</div>
                    </div>
                  )}
                  {edge30 && (
                    <div className="kpi-card">
                      <dt>Edge vs DIY, 30d</dt>
                      <dd style={{ color: edge30.value >= 0 ? "var(--pass)" : "var(--fail)" }}>{money(edge30.value)}</dd>
                      <div className="qualifier">{edge30.qualifiers.formula}</div>
                    </div>
                  )}
                  {edge7 && (
                    <div className="kpi-card">
                      <dt>Edge vs DIY, 7d</dt>
                      <dd style={{ color: edge7.value >= 0 ? "var(--pass)" : "var(--fail)" }}>{money(edge7.value)}</dd>
                      <div className="qualifier">{edge7.qualifiers.formula}</div>
                    </div>
                  )}
                  {dd30 && (
                    <div className="kpi-card">
                      <dt>Max drawdown, 30d</dt>
                      <dd>{dd30.value.toFixed(2)}%</dd>
                      <div className="qualifier">{dd30.qualifiers.formula}</div>
                    </div>
                  )}
                  {dd7 && (
                    <div className="kpi-card">
                      <dt>Max drawdown, 7d</dt>
                      <dd>{dd7.value.toFixed(2)}%</dd>
                      <div className="qualifier">{dd7.qualifiers.formula}</div>
                    </div>
                  )}
                </dl>
                {q && (
                  <details className="mt-m">
                    <summary className="xs" style={{ cursor: "pointer" }}>How this was measured, and what it cannot see</summary>
                    <p className="xs t-4" style={{ margin: "8px 0 0" }}>{q.denominator}</p>
                    <ul className="xs t-4" style={{ margin: "8px 0 0", paddingLeft: "18px" }}>
                      {q.knownDefects.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                    <p className="xs t-4" style={{ margin: "8px 0 0" }}>
                      Window {q.window}; {q.obsCount.toLocaleString()} observations (floor {q.obsFloor}); {q.costTreatment}.
                    </p>
                  </details>
                )}
              </div>
            );
          })()}

          {/* Hire vs do-it-yourself, per agent, at the point of decision.
              The corpus-wide Advantage Report lives at /compare; this answers
              the question the visitor actually has: does THIS agent beat me. */}
          {advantageRuns && (() => {
            const pairs = advantageRuns.runs.filter(
              (r) => r.agentMs != null && r.manualMs != null,
            );
            if (!advantageRuns.unavailable && pairs.length === 0) return null;
            if (advantageRuns.unavailable) {
              return (
                <p className="xs t-4 mt-m" style={{ marginBottom: 0 }}>
                  The hire-versus-DIY comparison could not be read just now.
                </p>
              );
            }
            const med = (xs: number[]) => {
              const s = [...xs].sort((a, b) => a - b);
              const m = Math.floor(s.length / 2);
              return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
            };
            const agentMed = med(pairs.map((r) => r.agentMs!));
            const manualMed = med(pairs.map((r) => r.manualMs!));
            const verified = pairs.filter((r) => r.evidenceVerified).length;
            const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60_000)}min`);
            const ratio = manualMed > 0 ? manualMed / agentMed : null;
            return (
              <div className="surface-card mt-m" style={{ borderLeft: "3px solid var(--accent)", padding: "14px 18px" }}>
                <p className="sm" style={{ margin: 0 }}>
                  <strong>Should you hire it, or do it yourself?</strong> Across{" "}
                  <span className="num">{pairs.length}</span> recorded task
                  {pairs.length === 1 ? "" : "s"} where both were timed, this agent&apos;s median
                  was <span className="num">{secs(agentMed)}</span> against{" "}
                  <span className="num">{secs(manualMed)}</span> by hand
                  {ratio ? ` (${ratio >= 1 ? ratio.toFixed(1) + "x faster" : (1 / ratio).toFixed(1) + "x slower"})` : ""}.
                </p>
                <p className="xs t-4" style={{ margin: "8px 0 0" }}>
                  {pairs.length} task pair{pairs.length === 1 ? "" : "s"}, medians; {verified} with
                  independently confirmed evidence; zero-budget jobs, so cost is gas only; output
                  quality is not scored. The corpus-wide report is on{" "}
                  <a href="/compare" style={{ color: "var(--accent)" }}>the Advantage Report</a>.
                </p>
              </div>
            );
          })()}

          {/* Manual attestations */}
          {attestations.length > 0 && (
            <>
              <h3 className="mt-l" style={{ fontSize: "1rem" }}>Hired tasks</h3>
              <div className="data-table-frame mt-m">
                <div className="rows">
                  <div className="rows-head r-hired">
                    <span>Task and result</span>
                    <span>Outcome</span>
                    <span style={{ textAlign: "right" }}>Took</span>
                    <span>When</span>
                  </div>
                  {attestations.map((t) => (
                    <div
                      key={t.id}
                      className="row r-hired"
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
                          {t.baselineDurationMs != null && (
                            <>
                              {" \u00b7 "}
                              <a href="/compare">compared against doing it by hand</a>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="xs" data-m="Outcome">
                        <span
                          className="pulse-dot"
                          data-status={OUTCOME_TONE[t.outcome] ?? "hold"}
                        />{" "}
                        {t.outcome}
                      </div>
                      <div className="num xs t-3" data-m="Took" style={{ textAlign: "right" }}>
                        {t.durationMs == null
                          ? "\u2014"
                          : t.durationMs < 1000
                            ? `${t.durationMs} ms`
                            : `${(t.durationMs / 1000).toFixed(1)}s`}
                      </div>
                      <div className="xs t-3" data-m="When">{ago(t.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── verified reviews: the L1 amendment ─────────────────────────
              Comments from wallets that provably completed an APEX escrow
              job with this agent as provider. Evidence, not a score: no
              stars, no averages, and never an ordering input - review count
              tracks hire volume, not quality (L3). The empty state is
              explicit by law (invariant 9 generalised here): a blank section
              would read as "reviewed and found mediocre". */}
          <div className="surface-card mt-m" style={{ borderLeft: "3px solid var(--accent)", padding: "14px 18px" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Verified reviews</h3>
            <p className="xs t-4" style={{ margin: "0 0 12px" }}>
              Comments from the wallet that hired, each anchored to an APEX escrow job
              that reached Completed with that wallet as its client - verified on chain,
              not taken on trust. What the probes cannot measure (liveness) and the
              escrow evaluator cannot grade (did it do what the brief said) lives here,
              in words. There is no score, and reviews never affect ordering.
            </p>
            {reviews.unavailable ? (
              <div className="notice" data-tone="hold">
                <span className="xs">
                  Verified reviews could not be read right now - unmeasured, not zero.
                  {" "}No agent is treated as unreviewed because our read failed.
                </span>
              </div>
            ) : reviews.reviews.length === 0 ? (
              <div className="notice" data-tone="hold">
                <span className="xs">
                  <strong>No verified reviews yet.</strong>{" "}
                  Reviews require a completed hire: an APEX escrow job that reached
                  Completed with the reviewer as its client.{" "}
                  <a href={`/a/${tokenId}/hire`} style={{ color: "var(--accent)" }}>
                    Complete a hire first
                  </a>{" "}
                  - then this section fills with evidence.
                </span>
              </div>
            ) : (
              <div className="stack-sm">
                {reviews.reviews.map((r) => (
                  <div key={r.id} style={{ borderTop: "1px solid var(--ink-850)", paddingTop: 10 }}>
                    <p className="sm" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.comment}</p>
                    <p className="xs t-4 num" style={{ margin: "6px 0 0" }}>
                      {r.reviewer.slice(0, 8)}...{r.reviewer.slice(-6)}
                      {" \u00b7 "}job #{r.jobId} on {r.chainId === 56 ? "BSC" : "BSC testnet"}
                      {" \u00b7 "}gate verified at block {r.checkedBlock}
                      {" \u00b7 "}{ago(r.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <ReviewForm tokenId={tokenId} agentName={a.name} />
          </div>

          {/* Probe history — shown for ALL agents with endpoints */}
          {probeHistory && probeHistory.days.length > 0 && (
            <>
              <h3 className="mt-l" style={{ fontSize: "1rem" }}>
                {attestations.length > 0 ? "Liveness history" : "Probe history (14 days)"}
              </h3>
              <p className="xs t-4 mt-s">
                {probeHistory.endpointKind?.toUpperCase()} endpoint:{" "}
                <span className="num">{probeHistory.endpointUrl?.slice(0, 60)}...</span>
                {" \u00b7 "}Each row is one day of independent probes.
              </p>
              <div className="data-table-frame mt-m">
                <div className="rows">
                  <div className="rows-head r-probe">
                    <span>Date</span>
                    <span style={{ textAlign: "right" }}>Probes</span>
                    <span style={{ textAlign: "right" }}>Passed</span>
                    <span style={{ textAlign: "right" }}>Uptime</span>
                    <span style={{ textAlign: "right" }}>p50</span>
                    <span>Fail streak</span>
                  </div>
                  {probeHistory.days.map((d) => (
                    <div
                      key={d.date}
                      className="row r-probe"
                    >
                      <div className="xs t-3 num">{d.date}</div>
                      <div className="num xs t-3" data-m="Probes" style={{ textAlign: "right" }}>{d.probes}</div>
                      <div className="num xs t-3" data-m="Passed" style={{ textAlign: "right" }}>{d.okCount}</div>
                      <div
                        className="num xs"
                        data-m="Uptime"
                        style={{
                          textAlign: "right",
                          color: (d.uptimePct ?? 0) >= 99 ? "var(--pass)" : (d.uptimePct ?? 0) >= 90 ? "var(--hold)" : "var(--fail)",
                        }}
                      >
                        {d.uptimePct != null ? `${d.uptimePct}%` : "\u2014"}
                      </div>
                      <div className="num xs t-3" data-m="p50" style={{ textAlign: "right" }}>
                        {d.p50Ms > 0 ? `${d.p50Ms} ms` : "\u2014"}
                      </div>
                      <div className="xs t-3" data-m="Fail streak" style={{ color: d.failStreak > 0 ? "var(--fail)" : undefined }}>
                        {d.failStreak > 0 ? `${d.failStreak} day${d.failStreak > 1 ? "s" : ""}` : "\u2014"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="xs t-4 mt-s">
                Measured by GEBO&apos;s probe cron from a single region. A failure here
                means unreachable from our infrastructure, not necessarily down everywhere.
              </p>
            </>
          )}

          {/* Neither attestations nor probe history */}
          {attestations.length === 0 && !probeHistory && (
            <div className="surface-card mt-m">
              <p className="prose sm" style={{ margin: 0 }}>
                No evidence is available for this agent yet.
              </p>
              <div className="notice mt-m" data-tone="hold">
                <strong>This is an absence of evidence, not evidence of absence.</strong>{" "}
                The agent may be perfectly functional; we have simply not probed it
                or tested it yet. Every agent with a declared endpoint will be probed
                on our next sweep.
              </div>
            </div>
          )}

          {attestations.length === 0 && probeHistory && probeHistory.totalProbes < 10 && (
            <div className="notice mt-m" data-tone="hold">
              <strong>{probeHistory.totalProbes} probe{probeHistory.totalProbes === 1 ? "" : "s"} is not a record.</strong>{" "}
              Read the rows, not the aggregate. Uptime over this few observations
              implies a reliability the evidence cannot support.
            </div>
          )}
        </div>
      </section>
          </>
        }
        badges={{
          "Registration": (a.lint?.defects?.length ?? 0) > 0 ? a.lint!.defects!.length : undefined,
          "Track record": attSummary?.total,
        }}
      />
    </>
  );
}
