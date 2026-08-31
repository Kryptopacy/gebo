import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { findAgent, trustState, classify, CATEGORIES, type CategorySlug } from "@/lib/data";
import { PRESETS, blastRadius, type BlastRadius } from "@/lib/session-scope";
import { simulateForCategory } from "@/lib/simulate";
import { attestationSummary } from "@/lib/attestations";
import ScopePicker from "./ScopePicker";
import { HireAction } from "./HireAction";
import { AltanaRail } from "./AltanaRail";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}): Promise<Metadata> {
  const { tokenId } = await params;
  const agent = await findAgent(tokenId);
  return { title: agent?.name ? `Authorise ${agent.name} — GEBO` : `Authorise — GEBO` };
}

export default async function HirePage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  const agent = await findAgent(tokenId);
  if (!agent) notFound();

  const st = trustState(agent);
  const m = classify(agent);
  const slug: CategorySlug = (m.category ?? "grid") as CategorySlug;
  const cat = CATEGORIES[slug];
  const name = agent.name ?? `Agent ${agent.token_id}`;

  const presets = PRESETS[slug] ?? PRESETS.grid!;
  const radii: Record<string, BlastRadius> = {};
  for (const p of presets) radii[p.id] = blastRadius(p);

  // Real quote from live chain state — no funded wallet involved.
  const sim = await simulateForCategory(m.category);

  // Track record, read independently and settled separately: a failure to read
  // must not block the hire, and must render as unmeasured, not as "no record".
  const attRes = await Promise.allSettled([attestationSummary(agent.token_id, 56)]);
  const trackRecord = attRes[0].status === "fulfilled" ? attRes[0].value : null;

  const blocked = st.state === "SHADOWED";

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb">
            <a href="/">GEBO</a> <span className="t-4">/</span>{" "}
            <a href={`/c/${slug}`}>{cat.job}</a> <span className="t-4">/</span>{" "}
            <a href={`/a/${agent.token_id}`}>#{agent.token_id}</a>{" "}
            <span className="t-4">/</span> Authorise
          </p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.7rem, 3vw, 2.2rem)" }}>Authorise {name}</h1>
            <p className="standfirst sm">
              Connect wallet, choose scope, then sign the hire transaction on chain.
              The agent acts within the limits you set — revocable anytime.
            </p>
          </div>
        </div>
      </section>

      {blocked && (
        <section className="band-tight">
          <div className="shell">
            <div className="notice" data-tone="fail">
              <strong>This agent cannot be authorised.</strong> {st.reason} Granting authority
              to an agent that no client can reach would put funds behind a door that does not
              open.
            </div>
          </div>
        </section>
      )}

      {/* ── 1 · scope ───────────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <div className="step-head">
            <span className="step-num num">01</span>
            <div>
              <h2>Choose the authority</h2>
              <p className="prose sm" style={{ marginBottom: 0 }}>
                Limits are enforced on chain by the session validator. A call outside them
                reverts during validation — not because GEBO or the agent chose to behave.
              </p>
            </div>
          </div>
          <div className="mt-m">
            <ScopePicker presets={presets} radii={radii} agentName={name} />
          </div>
        </div>
      </section>

      {/* ── 2 · simulate ────────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <div className="step-head">
            <span className="step-num num">02</span>
            <div>
              <h2>Simulate against live chain state</h2>
              <p className="prose sm" style={{ marginBottom: 0 }}>
                A representative action for this category, quoted from the chain as it stands
                right now. This is a real quote from PancakeSwap&apos;s Quoter or Venus&apos;s rate
                model, not an illustration.
              </p>
            </div>
          </div>

          <div className="sim mt-m" data-ok={sim.ok ? "true" : "false"}>
            <div className="sim-head">
              <span>{sim.ok ? "Simulation result" : "Simulation unavailable"}</span>
              {sim.block && <span className="num xs t-4">block {Number(sim.block).toLocaleString()}</span>}
            </div>
            <div className="sim-body">
              <p className="sim-headline">{sim.headline}</p>

              {sim.error && <p className="sm" style={{ color: "var(--fail)" }}>{sim.error}</p>}

              {sim.deltas.length > 0 && (
                <div className="deltas">
                  {sim.deltas.map((d, i) => (
                    <div key={i} className="delta" data-dir={d.direction}>
                      <span className="num">{d.direction === "out" ? "−" : "+"} {d.amount}</span>
                      <span className="xs t-4">{d.direction === "out" ? "leaves your wallet" : "arrives"}</span>
                    </div>
                  ))}
                </div>
              )}

              {sim.calls.length > 0 && (
                <dl className="spec mt-m">
                  {sim.calls.map((c, i) => (
                    <div key={i}>
                      <dt>{c.fn}</dt>
                      <dd>
                        <div>{c.summary}</div>
                        <div className="xs t-4 num" style={{ marginTop: 4 }}>{c.contract} · {c.contractAddress}</div>
                        {c.detail.map((d, j) => (
                          <div key={j} className="xs t-3 num">{d}</div>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {sim.gasEstimate && (
                <p className="xs t-4" style={{ marginTop: 12 }}>
                  Gas estimate {Number(sim.gasEstimate).toLocaleString()} units, reported by the quoter.
                </p>
              )}

              {sim.notes.length > 0 && (
                <ul className="sim-notes">
                  {sim.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3 · hire ────────────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <div className="step-head">
            <span className="step-num num">03</span>
            <div>
              <h2>Hire on chain</h2>
              <p className="prose sm" style={{ marginBottom: 0 }}>
                Two rails to the same escrow. Rail 1: your browser wallet signs the
                APEX (ERC-8183) transactions directly. Rail 2: the Altana SDK&apos;s
                buyer side - a passkey wallet and one atomic relay intent. Both are
                zero-budget by policy: the job traverses Open → Funded → Submitted →
                Completed, and cost is a true zero. Revocable anytime.
              </p>
            </div>
          </div>

          {/* Track record at the point of signing, not one click away: the
              attestation ledger is part of the pre-hire decision, and a hirer
              who never saw it is deciding blind. */}
          {trackRecord === null ? (
            <p className="xs t-4 mt-m" style={{ marginBottom: 0 }}>
              Track record could not be read just now. The attestation ledger is on{" "}
              <a href={`/a/${agent.token_id}`} style={{ color: "var(--accent)" }}>this agent&apos;s card</a>{" "}
              if the read recovers.
            </p>
          ) : trackRecord.total === 0 ? (
            <p className="xs t-4 mt-m" style={{ marginBottom: 0 }}>
              No attestation has ever been recorded for this agent. Hiring it now makes you the
              first data point other hirers will see.
            </p>
          ) : (
            <p className="xs" style={{ marginBottom: 0 }}>
              <span className="num">{trackRecord.total}</span> attestation{trackRecord.total === 1 ? "" : "s"} on record ·{" "}
              <span className="num" style={{ color: "var(--pass)" }}>{trackRecord.succeeded}</span> succeeded ·{" "}
              <span className="num">{trackRecord.verified}</span> with independently confirmed evidence ·{" "}
              <span className="num">{trackRecord.distinctAttesters}</span> distinct attesters.{" "}
              <a href={`/a/${agent.token_id}`} style={{ color: "var(--accent)" }}>Full ledger →</a>
            </p>
          )}

          <p className="section-label mt-m">Rail 1 - direct APEX with your browser wallet</p>
          <HireAction
            agentTokenId={agent.token_id}
            agentName={name}
            categorySlug={slug}
            providerAddress={agent.owner_address}
          />
          <AltanaRail
            agentTokenId={agent.token_id}
            agentName={name}
            categorySlug={slug}
            providerAddress={agent.owner_address}
          />
        </div>
      </section>

      {/* ── 4 · revoke ──────────────────────────────────────────────── */}
      <section className="band band-last">
        <div className="shell">
          <div className="step-head">
            <span className="step-num num">04</span>
            <div>
              <h2>Revocation, before you ever need it</h2>
              <p className="prose sm" style={{ marginBottom: 0 }}>
                Revocation is one transaction against the keystore and needs no cooperation
                from the agent. It is shown here, before granting, because a control you only
                discover after something goes wrong is not a control.
              </p>
            </div>
          </div>

          <dl className="spec mt-m">
            <div>
              <dt>Method</dt>
              <dd className="num">revokeKey(user, keyId)</dd>
            </div>
            <div>
              <dt>Keystore</dt>
              <dd className="num">0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a</dd>
            </div>
            <div>
              <dt>Effect</dt>
              <dd>Immediate and monotonic. A revoked key cannot be reinstated.</dd>
            </div>
            <div>
              <dt>Verifiable by</dt>
              <dd>
                Anyone. <span className="num">isValidKey(user, keyId)</span> is a free public
                read requiring no admin key and nothing from Altana.
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
