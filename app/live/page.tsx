import { livenessSummary, recentTransitions, uptimeTable } from "@/lib/liveness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MIN_PROBES = 5;

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function LivePage() {
  const [s, transitions, uptime] = await Promise.all([
    livenessSummary(),
    recentTransitions(40),
    uptimeTable(MIN_PROBES, 40),
  ]);

  const answerRate = s.probesToday > 0
    ? ((s.answeringToday / s.probesToday) * 100).toFixed(1)
    : null;

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Liveness</p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.6rem)" }}>
              Which agents are actually answering
            </h1>
            <p className="standfirst">
              Measured by probing every callable endpoint on a tiered schedule, not read from
              a registry field. Published so anyone can use it.
            </p>
          </div>
        </div>
      </section>

      <section className="band-tight">
        <div className="shell">
          <dl className="kpi-grid">
            <div className="kpi-card">
              <dt style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="pulse-dot" data-status="pass" />
                Probes recorded
              </dt>
              <dd>{s.probesRecorded.toLocaleString()}</dd>
              <div className="qualifier">
                Across {s.endpointsTracked.toLocaleString()} endpoints, {s.daysOfHistory} day
                {s.daysOfHistory === 1 ? "" : "s"} of history
              </div>
            </div>
            <div className="kpi-card">
              <dt>Answering today</dt>
              <dd style={{ color: s.answeringToday > 0 ? "var(--pass)" : "var(--fg-4)" }}>
                {answerRate ? `${answerRate}%` : "—"}
              </dd>
              <div className="qualifier">
                {s.answeringToday.toLocaleString()} of {s.probesToday.toLocaleString()} probes,{" "}
                {s.validatedToday.toLocaleString()} completed a protocol handshake
              </div>
            </div>
            <div className="kpi-card">
              <dt>State changes</dt>
              <dd>{s.transitions.toLocaleString()}</dd>
              <div className="qualifier">
                {s.transitionsToday.toLocaleString()} today. Only changes are stored; an
                unchanged state is not news
              </div>
            </div>
            <div className="kpi-card">
              <dt>Response p50 / p95</dt>
              <dd style={{ fontSize: "1.45rem" }}>
                {s.p50Ms ?? "—"}
                <span className="t-4" style={{ fontSize: "0.85rem" }}> / {s.p95Ms ?? "—"} ms</span>
              </dd>
              <div className="qualifier">Single-region measurement, disclosed as a defect</div>
            </div>
          </dl>
        </div>
      </section>

      <section className="band">
        <div className="shell">
          <p className="section-label">01 · Real-Time Transition Log</p>
          <h2>Agents that changed state</h2>
          <p className="prose sm">
            The moment an agent stops answering, or starts again. No other index records this,
            which is why an abandoned listing looks identical to a working one everywhere else.
          </p>

          {transitions.length === 0 ? (
            <div className="surface-card mt-m">
              <div className="sm t-3">
                No transitions recorded yet. A transition needs at least two probes of the
                same endpoint with different outcomes, so this fills in as the schedule runs.
              </div>
            </div>
          ) : (
            <div className="data-table-frame mt-m">
              <div className="rows">
                <div className="rows-head" style={{ gridTemplateColumns: "7rem minmax(0,1.3fr) 1fr 9rem minmax(0,1fr)" }}>
                  <span>When</span><span>Agent</span><span>Operator</span><span>Change</span><span>Reason</span>
                </div>
                {transitions.map((t, i) => {
                  const worse = t.to === "DORMANT" || t.to === "SHADOWED";
                  return (
                    <div key={`${t.at}-${i}`} className="row" style={{ gridTemplateColumns: "7rem minmax(0,1.3fr) 1fr 9rem minmax(0,1fr)" }}>
                      <div className="num xs t-4">{ago(t.at)}</div>
                      <div>
                        {t.tokenId ? (
                          <a href={`/a/${t.tokenId}`} style={{ color: "var(--fg)" }}>
                            {t.name ?? `Agent ${t.tokenId}`}
                          </a>
                        ) : (
                          <span className="t-4">unknown</span>
                        )}
                        {t.tokenId && <div className="xs t-4 num">#{t.tokenId}</div>}
                      </div>
                      <div className="num xs t-3">{t.operator ?? "—"}</div>
                    <div className="xs num">
                      <span className="t-4">{t.from ?? "new"}</span>
                      <span className="t-4"> {"->"} </span>
                      <span style={{ color: worse ? "var(--fail)" : "var(--pass)" }}>{t.to}</span>
                    </div>
                    <div className="xs t-3">
                      {t.reason}
                      {t.errClass && t.errClass !== "ok" && (
                        <span className="t-4 num"> ({t.errClass})</span>
                      )}
                    </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="band">
        <div className="shell">
          <p className="section-label">02 · Verified Reliability</p>
          <h2>Measured uptime</h2>
          <p className="prose sm">
            Endpoints with at least {MIN_PROBES} observations. Below that threshold a percentage
            is not uptime, so it is withheld rather than shown flatteringly. The observation
            count travels with every figure.
          </p>

          {uptime.length === 0 ? (
            <div className="surface-card mt-m">
              <div className="sm t-3">
                No endpoint has reached {MIN_PROBES} observations yet.
              </div>
            </div>
          ) : (
            <div className="data-table-frame mt-m">
              <div className="rows">
                <div className="rows-head" style={{ gridTemplateColumns: "minmax(0,1.3fr) 1fr 6rem 6rem 7rem 7rem" }}>
                  <span>Agent</span><span>Operator</span>
                  <span style={{ textAlign: "right" }}>Uptime</span>
                  <span style={{ textAlign: "right" }}>Probes</span>
                  <span style={{ textAlign: "right" }}>p50</span>
                  <span>Last answer</span>
                </div>
                {uptime.map((u) => (
                  <a key={`${u.tokenId}-${u.kind}`} href={`/a/${u.tokenId}`} className="row row-hover" style={{ gridTemplateColumns: "minmax(0,1.3fr) 1fr 6rem 6rem 7rem 7rem" }}>
                    <div>
                      <h3>{u.name ?? `Agent ${u.tokenId}`}</h3>
                      <div className="xs t-4 num">#{u.tokenId} · {u.kind.toUpperCase()}</div>
                    </div>
                    <div className="num xs t-3">{u.operator ?? "—"}</div>
                    <div className="num sm" style={{ textAlign: "right", color: u.uptimePct >= 95 ? "var(--pass)" : u.uptimePct >= 50 ? "var(--hold)" : "var(--fail)" }}>
                      {u.uptimePct}%
                    </div>
                    <div className="num xs t-3" style={{ textAlign: "right" }}>
                      {u.probes}
                      <span className="t-4"> / {u.days}d</span>
                    </div>
                    <div className="num xs t-3" style={{ textAlign: "right" }}>
                      {u.p50Ms != null ? `${u.p50Ms} ms` : "—"}
                    </div>
                    <div className="xs t-3">
                      {u.lastOkAt ? ago(u.lastOkAt) : <span style={{ color: "var(--fail)" }}>never</span>}
                      {u.failStreak > 0 && (
                        <div className="xs" style={{ color: "var(--fail)" }}>{u.failStreak} consecutive failures</div>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="band band-last">
        <div className="shell">
          <h2>How this is measured, and where it falls short</h2>

          {s.errorClasses.length > 0 && (
            <>
              <p className="prose sm">
                Failures are classified rather than counted, because &ldquo;DNS does not
                resolve&rdquo; is an abandoned agent while &ldquo;timed out&rdquo; may be a live
                one we cannot reach. Conflating them would overstate how much of the chain is
                dead.
              </p>
              <div className="data-table-frame mt-m">
                <div className="rows">
                  <div className="rows-head" style={{ gridTemplateColumns: "12rem 8rem minmax(0,1fr)" }}>
                    <span>Outcome</span><span style={{ textAlign: "right" }}>Count</span><span>Meaning</span>
                  </div>
                  {s.errorClasses.map((e) => (
                    <div key={e.cls} className="row" style={{ gridTemplateColumns: "12rem 8rem minmax(0,1fr)" }}>
                      <div className="num sm">{e.cls}</div>
                      <div className="num sm" style={{ textAlign: "right" }}>{e.n.toLocaleString()}</div>
                      <div className="xs t-3">
                        {{
                          ok: "Responded successfully",
                          dns: "Domain does not resolve. The strongest signal of abandonment.",
                          timeout: "No response in time. May be alive but unreachable from here.",
                          tls: "Certificate or TLS failure.",
                          refused: "Connection actively refused.",
                          reset: "Connection dropped mid-request.",
                          http_4xx: "Answered with a client error. A server exists; the endpoint does not.",
                          http_5xx: "Answered with a server error.",
                          non_json: "Answered, but not with parseable JSON.",
                          bad_url: "The registered URL is not usable.",
                          other: "Unclassified failure.",
                        }[e.cls] ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="surface-card mt-l">
            <dl className="spec">
              <div>
                <dt>Cadence</dt>
                <dd>
                  Tiered by last outcome: answering endpoints every 15 minutes, responding-but-not
                  -speaking every 6 hours, failing every 3 days. A fatal registration defect is
                  never requested, because a broken URL cannot improve.
                </dd>
              </div>
              <div>
                <dt>What counts as answering</dt>
                <dd>
                  An A2A card that parses and validates, or an MCP{" "}
                  <span className="num">initialize</span> that returns a usable result. An HTTP 200
                  alone proves a server answered, not that an agent exists behind it.
                </dd>
              </div>
              <div>
                <dt>Known defect</dt>
                <dd>
                  Single vantage point. An agent that geo-blocks or ASN-blocks us appears dead, and
                  we cannot distinguish being down from being unreachable from here. Multi-region
                  probing with majority consensus is the fix and is not yet built.
                </dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>
                  Daily counters plus transitions, not one row per probe. At this cadence the raw
                  form would be roughly 1.75M rows and 306 MB a day, which is why nobody keeps it
                  that way.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}
