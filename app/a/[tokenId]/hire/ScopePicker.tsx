"use client";

/**
 * Scope selector.
 *
 * The blast radius updates as the scope changes, because the point of this step
 * is that the consequence of a choice is visible at the moment it is made —
 * not disclosed afterwards in a confirmation dialog.
 */
import { useState } from "react";
import type { ScopePreset, BlastRadius } from "@/lib/session-scope";

type Props = {
  presets: ScopePreset[];
  radii: Record<string, BlastRadius>;
  agentName: string;
};

export default function ScopePicker({ presets, radii, agentName }: Props) {
  const [selected, setSelected] = useState(presets[0]?.id ?? "");
  const preset = presets.find((p) => p.id === selected) ?? presets[0];
  const radius = preset ? radii[preset.id] : undefined;

  if (!preset || !radius) {
    return (
      <div className="rows">
        <div className="row" style={{ gridTemplateColumns: "1fr" }}>
          <div className="sm t-3">No scope presets defined for this category yet.</div>
        </div>
      </div>
    );
  }

  const days = Math.round(radius.expiresInHours / 24);
  const expiry = radius.expiresInHours >= 24
    ? `${days} day${days === 1 ? "" : "s"}`
    : `${radius.expiresInHours} hours`;

  return (
    <>
      <div className="scope-options" role="radiogroup" aria-label="Authority scope">
        {presets.map((p) => {
          const r = radii[p.id];
          const active = p.id === selected;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`scope-option${active ? " is-active" : ""}`}
              onClick={() => setSelected(p.id)}
            >
              <span className="scope-name">{p.name}</span>
              <span className="scope-summary">{p.summary}</span>
              <span className="scope-meta num">
                {r?.caps.length
                  ? r.caps.map((c) => `${c.humanAmount} ${c.symbol}/${c.period}`).join(" · ")
                  : "no spending authority"}
              </span>
            </button>
          );
        })}
      </div>

      <div className={`authority mt-l${radius.unbounded ? "" : ""}`} data-risk={radius.unbounded ? "unknown" : "scoped"}>
        <div className="authority-head">
          {radius.unbounded
            ? "Unbounded — no contract allowlist"
            : `What ${agentName} could do to your wallet`}
        </div>
        <div className="authority-body">
          <dl className="spec">
            <div>
              <dt>Contracts</dt>
              <dd>
                {radius.contracts.length === 0 ? (
                  <span className="t-4">none — the agent cannot call anything</span>
                ) : (
                  <div className="stack-sm">
                    {radius.contracts.map((c) => (
                      <div key={c.address}>
                        <span style={{ color: "var(--fg)" }}>{c.label}</span>
                        <div className="xs t-4 num">{c.address}</div>
                        <div className="xs t-3">{c.note}</div>
                      </div>
                    ))}
                  </div>
                )}
              </dd>
            </div>

            <div>
              <dt>Intended functions</dt>
              <dd>
                {radius.selectors.length === 0 ? (
                  <span className="t-4">
                    {radius.contracts.length ? "any function on the contracts above" : "none"}
                  </span>
                ) : (
                  <div className="stack-sm">
                    {radius.selectors.map((s) => (
                      <div key={s.signature}>
                        <span className="num" style={{ color: s.risk === "approve" ? "var(--fail)" : "var(--fg-2)" }}>
                          {s.signature.split("(")[0]}
                        </span>
                        <span className="xs t-3"> — {s.note}</span>
                      </div>
                    ))}
                  </div>
                )}
              </dd>
            </div>

            <div>
              <dt>Spend cap</dt>
              <dd>
                {radius.caps.length === 0 ? (
                  <span className="t-4">none</span>
                ) : (
                  <div className="stack-sm">
                    {radius.caps.map((c) => (
                      <div key={String(c.token)} className="num">
                        {c.humanAmount} {c.symbol} per {c.period}
                        <span className="xs t-4"> · {c.limit.toString()} base units ({c.decimals} decimals)</span>
                      </div>
                    ))}
                  </div>
                )}
              </dd>
            </div>

            <div>
              <dt>Expires</dt>
              <dd className="num">in {expiry}</dd>
            </div>

            <div>
              <dt>Worst case</dt>
              <dd style={{ color: radius.unbounded ? "var(--fail)" : "var(--fg-2)" }}>
                {radius.worstCase ?? "unknown — declining to estimate"}
              </dd>
            </div>
          </dl>

          {radius.warnings.length > 0 && (
            <div className="stack-sm" style={{ marginTop: 14, marginBottom: 6 }}>
              {radius.warnings.map((w, i) => (
                <div key={i} className="notice" data-tone="fail" style={{ padding: "10px 0 10px 14px" }}>
                  <span className="sm">{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="xs t-4 mt-m">
        The session scopes by <strong>contract</strong>, not by function � verified on BNB
        testnet. The functions listed above are what the agent intends to call, shown for
        transparency; an allowlisted contract can be reached in other ways. Spending is
        constrained separately, and an uncapped token cannot be moved even on a permitted
        contract.
      </p>
      <p className="xs t-4 mt-m">
        Base units are shown because the same stablecoin uses 6 decimals on some chains and
        18 on BNB Chain. A cap built against the wrong assumption is out by a factor of a
        trillion, so GEBO constructs every cap from a per-token decimals table and prints the
        result for inspection.
      </p>
    </>
  );
}
