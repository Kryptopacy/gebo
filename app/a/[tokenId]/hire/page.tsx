import { notFound } from "next/navigation";
import { findAgent, trustState, classify, CATEGORIES, type CategorySlug } from "@/lib/data";
import { PRESETS, blastRadius, buildPermissions, canonicalise, type BlastRadius } from "@/lib/session-scope";
import { simulateForCategory } from "@/lib/simulate";
import ScopePicker from "./ScopePicker";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const standard = presets.find((p) => p.id === "standard") ?? presets[0]!;
  const commitment = canonicalise(buildPermissions(standard));

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
              Nothing is signed on this page. Choose what the agent may do, watch the
              consequence of that choice, then see exactly what a grant would contain.
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

      {/* ── 3 · grant ───────────────────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <div className="step-head">
            <span className="step-num num">03</span>
            <div>
              <h2>What a grant would contain</h2>
              <p className="prose sm" style={{ marginBottom: 0 }}>
                The exact permission object, serialised the way it must be signed. Altana
                matches these bytes when the session executes, so key order is fixed and
                amounts stay decimal strings — coercing them to numbers would silently lose
                precision above 2^53.
              </p>
            </div>
          </div>

          <pre className="payload mt-m">{JSON.stringify(JSON.parse(commitment), null, 2)}</pre>

          <div className="notice mt-l">
            <strong>Signing is not yet enabled.</strong> The grant transaction requires a
            funded wallet on BNB Chain, and GEBO deliberately does not custody keys or ask for
            a private key. Everything above is real and verifiable without one — the scope, the
            enforced limits, and the quote are all live.
          </div>
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
