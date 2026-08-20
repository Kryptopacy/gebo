import { notFound } from "next/navigation";
import { loadAgents, findAgent, trustState, classify, CATEGORIES } from "@/lib/data";

export const dynamic = "force-static";

export async function generateStaticParams() {
  const agents = await loadAgents();
  return agents.slice(0, 400).map((a) => ({ tokenId: a.token_id }));
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
          <dl className="readouts">
            <div className="readout">
              <dt>Handshake</dt>
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
            <div className="readout">
              <dt>Round trip</dt>
              <dd>{a.probe?.rttMs != null ? `${a.probe.rttMs}` : "—"}
                {a.probe?.rttMs != null && <span className="t-4" style={{ fontSize: "0.8rem" }}> ms</span>}
              </dd>
              <div className="qualifier">One observation, one region. Not an average.</div>
            </div>
            <div className="readout">
              <dt>Transport</dt>
              <dd style={{ fontSize: "1rem", letterSpacing: 0 }}>
                {a.probe?.httpStatus ?? "—"} <span className="t-4">{a.probe?.errClass}</span>
              </dd>
              <div className="qualifier">HTTP status and classified outcome</div>
            </div>
            <div className="readout" data-empty="true">
              <dt>Uptime 7d</dt>
              <dd>Insufficient observations</dd>
              <div className="qualifier">n=1, floor=20. Shown once a real record exists.</div>
            </div>
          </dl>

          {a.probe?.evidence && (
            <dl className="spec mt-m">
              {Object.entries(a.probe.evidence).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className="mono">{v === null ? "—" : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {/* ── authority ────────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <h2>What it could do to your wallet</h2>
          <div className="authority mt-m" data-risk="unknown">
            <div className="authority-head">No session registered in the keystore</div>
            <div className="authority-body">
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
          <dl className="spec mt-m">
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
      </section>

      {/* ── indexer comparison ───────────────────────────────────── */}
      <section className={a.lint?.defects?.length ? "band" : "band band-last"}>
        <div className="shell">
          <p className="section-label">For comparison · what the indexer reports</p>
          <dl className="readouts">
            <div className="readout">
              <dt>health_score</dt>
              <dd>{a.scan.health_score ?? "—"}</dd>
              <div className="qualifier">Non-monotonic against measured reachability</div>
            </div>
            <div className="readout">
              <dt>is_active</dt>
              <dd style={{ fontSize: "1rem", letterSpacing: 0, color: a.scan.is_active ? "var(--hold)" : "var(--fg-4)" }}>
                {String(a.scan.is_active)}
              </dd>
              <div className="qualifier">Self-declared in the registration file, unverified</div>
            </div>
            <div className="readout">
              <dt>total_score</dt>
              <dd>{a.scan.total_score}</dd>
              <div className="qualifier">Their composite. We neither display nor rank on it.</div>
            </div>
            <div className="readout">
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
        <section className="band band-last">
          <div className="shell">
            <h2>Registration audit</h2>
            <div className="rows mt-m">
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
        </section>
      )}
    </>
  );
}
