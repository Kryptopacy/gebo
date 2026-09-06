import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifySessionToken, adminPasswordConfigured } from "@/lib/admin-auth";
import { loadAdminData } from "@/lib/admin-data";
import { AutoRefresh, TriggerButton, LogoutButton } from "./AdminClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Ops — GEBO", robots: { index: false, follow: false } };

const FREE_TIER_BYTES = 500 * 1024 * 1024;

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function PanelBox({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-l">
      <h2 style={{ fontSize: "1.15rem" }}>{title}</h2>
      {note && <p className="prose sm">{note}</p>}
      {children}
    </section>
  );
}

function Unavailable({ reason }: { reason: string | null }) {
  return (
    <div className="notice mt-m" data-tone="fail">
      <strong>This panel could not be read.</strong> A failed measurement is not a
      measurement of zero{reason ? ` — reported cause: ${reason}` : ""}.
    </div>
  );
}

export default async function AdminPage() {
  const jar = await cookies();
  if (!verifySessionToken(jar.get(ADMIN_COOKIE)?.value)) {
    redirect("/admin/login");
  }

  const d = await loadAdminData();
  const p = d.pipeline.data;
  const crons = d.crons.data;
  const dbp = d.database.data;
  const f = d.funnel.data;
  const cls = d.classification.data;

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Ops</p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.7rem, 3.2vw, 2.3rem)" }}>Operations</h1>
            <p className="standfirst">
              The same truth `npm run readiness` reports, readable in a browser: pipeline lag, cron
              health, database headroom and the funnel, each measured on request. Manual runs call
              the exact cron routes pg_net calls - nothing here has its own logic.
            </p>
          </div>
          <p className="mt-m" style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <AutoRefresh seconds={60} />
            <LogoutButton />
          </p>
        </div>
      </section>

      <section className="band band-last">
        <div className="shell">

          <PanelBox
            title="Pipeline"
            note="The materialize gate from readiness: surfaces read `agents`, not the census, so the high-water lag is the failure that once made 67k agents invisible."
          >
            {d.pipeline.unavailable || !p ? <Unavailable reason={d.pipeline.reason} /> : (
              <>
                <div className="rows-head r-spec"><span>Measure</span><span>Value</span></div>
                <div className="rows">
                  <div className="row r-spec"><span>Census high-water (token #)</span><span className="num">{p.censusMax.toLocaleString()}</span></div>
                  <div className="row r-spec"><span>Agents high-water (token #)</span><span className="num">{p.agentsMax.toLocaleString()}</span></div>
                  <div className="row r-spec">
                    <span>Lag</span>
                    <span className="num" style={{ color: p.lag <= 2000 ? "var(--pass)" : "var(--hold)" }}>{p.lag.toLocaleString()}</span>
                  </div>
                  <div className="row r-spec"><span>Backlog (resolved+named not yet in agents)</span><span className="num">{p.backlog.toLocaleString()}</span></div>
                  <div className="row r-spec"><span>Materialized in last 15 min</span><span className="num">{p.materializedLast15m.toLocaleString()} {p.fatRowsLast15m > 0 ? <span style={{ color: "var(--fail)" }}>({p.fatRowsLast15m} fat rows — old code still deployed?)</span> : ""}</span></div>
                  <div className="row r-spec"><span>Remote registrations awaiting resolve (≤3 attempts)</span><span className="num">{p.unresolvedRemote.toLocaleString()}</span></div>
                  <div className="row r-spec"><span>Endpoints tracked / callable agents</span><span className="num">{p.endpoints.toLocaleString()} / {p.callable.toLocaleString()}</span></div>
                </div>
              </>
            )}
          </PanelBox>

          <PanelBox
            title="Scheduled jobs"
            note="A cron job that pg_net reports 'succeeded' only queued an HTTP request — the response codes below are the truth. Non-200s persisting across an hour are the pg_net failure shape."
          >
            {d.crons.unavailable || !crons ? <Unavailable reason={d.crons.reason} /> : (
              <>
                <div className="rows-head r-jobs"><span>Job</span><span>Schedule</span><span>Active</span></div>
                <div className="rows">
                  {crons.jobs.map((j) => (
                    <div className="row r-jobs" key={j.jobname}>
                      <span>{j.jobname}</span>
                      <span className="num">{j.schedule}</span>
                      <span style={{ color: j.active ? "var(--pass)" : "var(--fail)" }}>{j.active ? "active" : "INACTIVE"}</span>
                    </div>
                  ))}
                </div>
                <p className="prose sm mt-m">
                  pg_net responses (1h):{" "}
                  {crons.pgNet.length
                    ? crons.pgNet.map((c) => (
                        <span key={c.code} className="num" style={{ color: c.code === 200 ? "var(--pass)" : "var(--fail)" }}>
                          {" "}{c.code}×{c.n}
                        </span>
                      ))
                    : " none in the last hour"}
                </p>
                <div className="rows-head r-dir mt-m"><span>Recent runs (2h)</span><span>Status</span><span>When</span></div>
                <div className="rows">
                  {crons.recentRuns.map((r, i) => (
                    <div className="row r-dir" key={i}>
                      <span>{r.jobname}</span>
                      <span style={{ color: r.status === "succeeded" ? "var(--pass)" : "var(--fail)" }}>{r.status}</span>
                      <span className="num">{r.end.slice(11, 19)} UTC</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </PanelBox>

          <PanelBox
            title="Manual runs"
            note="Each button calls this deployment's own cron route with the server-held CRON_SECRET — the same call pg_net makes, on demand. Results are relayed verbatim."
          >
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {["materialize", "sync", "resolve", "probe", "classify", "opportunities", "emerging", "grid-record", "regrant"].map((j) => (
                <TriggerButton key={j} job={j} />
              ))}
            </div>
          </PanelBox>

          <PanelBox
            title="Database"
            note="Free tier is 500 MB. The VACUUM trap is documented in AGENTS.md: reclaims only work through the session pooler, never the transaction pooler."
          >
            {d.database.unavailable || !dbp ? <Unavailable reason={d.database.reason} /> : (
              <>
                <div className="rows-head r-operators"><span>Table</span><span>Rows</span><span>Size</span><span>Share</span></div>
                <div className="rows">
                  <div className="row r-operators">
                    <span><strong>total database</strong></span>
                    <span className="num">{mb(dbp.sizeBytes)}</span>
                    <span className="num">{((dbp.sizeBytes / FREE_TIER_BYTES) * 100).toFixed(0)}%</span>
                    <span>of the 500 MB free tier</span>
                  </div>
                  {dbp.topTables.map((t) => (
                    <div className="row r-operators" key={t.name}>
                      <span>{t.name}</span>
                      <span className="num">{t.rows.toLocaleString()}</span>
                      <span className="num">{mb(t.sizeBytes)}</span>
                      <span className="num">{((t.sizeBytes / FREE_TIER_BYTES) * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </PanelBox>

          <PanelBox title="Funnel" note="Census figures served on the landing page, from census_stats.">
            {d.funnel.unavailable || !f ? <Unavailable reason={d.funnel.reason} /> : (
              <div className="rows">
                <div className="row r-spec"><span>Tokens minted / censused</span><span className="num">{f.tokensMinted.toLocaleString()} / {f.censused.toLocaleString()}</span></div>
                <div className="row r-spec"><span>Resolved / named</span><span className="num">{f.resolved.toLocaleString()} / {f.named.toLocaleString()}</span></div>
                <div className="row r-spec"><span>Claim active / with endpoint / callable</span><span className="num">{f.claimActive.toLocaleString()} / {f.withEndpoint.toLocaleString()} / {f.callable.toLocaleString()}</span></div>
                <div className="row r-spec"><span>Agents materialized</span><span className="num">{f.agents.toLocaleString()}</span></div>
              </div>
            )}
          </PanelBox>

          <PanelBox
            title="Classification & trust"
            note="Rules fingerprint-keyed, so a rule edit re-qualifies every agent exactly once. Judged counts are measured reality, never padded."
          >
            {d.classification.unavailable || !cls ? <Unavailable reason={d.classification.reason} /> : (
              <>
                <div className="rows">
                  <div className="row r-spec"><span>Rules fingerprint</span><span className="num">{cls.rulesFingerprint}</span></div>
                  <div className="row r-spec"><span>Examined by current rules / queued</span><span className="num">{cls.applied.toLocaleString()} / {cls.queued.toLocaleString()}</span></div>
                  <div className="row r-spec"><span>Judged (rebalancing, grid, yield, health)</span><span className="num">{cls.judged.toLocaleString()}</span></div>
                </div>
                <div className="rows-head r-jobs mt-m"><span>Trust state</span><span>Agents</span><span>Share</span></div>
                <div className="rows">
                  {cls.trustStates.map((s) => (
                    <div className="row r-jobs" key={s.state}>
                      <span>{s.state}</span>
                      <span className="num">{s.n.toLocaleString()}</span>
                      <span className="num">{f && f.agents ? ((s.n / f.agents) * 100).toFixed(1) : "—"}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </PanelBox>

        </div>
      </section>
    </>
  );
}
