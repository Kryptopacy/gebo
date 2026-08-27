"use client";

/**
 * Floating product-assistant widget, mounted in the root layout so it is
 * available on every page. The assistant is read-only: it navigates and
 * explains; anything that touches a wallet happens in the hire flow, never
 * here.
 *
 * Inline styles only: the visual layer (globals.css) is owned separately, and
 * a self-contained widget cannot break the rest of the page if those styles
 * change underneath it.
 */
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "What agents can watch my Venus lending position?",
  "How does GEBO decide an agent is verified?",
  "Show me the difference between rebalancing and grid trading",
  "How many registered agents are actually hireable?",
];

/**
 * Widget styles live here rather than in globals.css because the visual layer
 * is owned separately. Class names are prefixed so they cannot collide.
 * All animation is off under prefers-reduced-motion.
 */
const WIDGET_CSS = `
.gebo-assistant-btn {
  position: fixed; right: 20px; bottom: 20px; z-index: 1200;
  width: 52px; height: 52px; border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--fg-4);
  cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(0,0,0,0.28);
  transition: box-shadow 0.2s ease, filter 0.2s ease;
  animation: gebo-enter 0.5s ease-out, gebo-breathe 3.4s ease-in-out 0.5s infinite;
}
.gebo-assistant-btn:hover { filter: brightness(1.12); box-shadow: 0 6px 20px rgba(0,0,0,0.38); }
.gebo-assistant-btn[data-busy="true"] { animation-play-state: paused; }
.gebo-assistant-btn img { width: 30px; height: 30px; pointer-events: none; }
.gebo-assistant-ring {
  position: absolute; inset: -3px; border-radius: 999px;
  border: 2px solid var(--accent); border-top-color: transparent;
  animation: gebo-spin 0.9s linear infinite;
}
@keyframes gebo-enter { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
@keyframes gebo-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes gebo-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .gebo-assistant-btn { animation: none; }
  .gebo-assistant-ring { animation: none; }
}
`;

/** Minimal markdown: links, bold, line breaks. Nothing else is interpreted. */
function renderInline(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined && m[2] !== undefined) {
      const href = m[2].startsWith("/") ? m[2] : undefined;
      parts.push(
        href ? (
          <a key={`${keyPrefix}-l${i}`} href={href} style={{ color: "var(--accent)" }}>
            {m[1]}
          </a>
        ) : (
          <span key={`${keyPrefix}-l${i}`}>{m[1]}</span>
        ),
      );
    } else if (m[3] !== undefined) {
      parts.push(<strong key={`${keyPrefix}-b${i}`}>{m[3]}</strong>);
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdownish({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {renderInline(line, `ln${i}`)}
        </span>
      ))}
    </>
  );
}

export default function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setUnavailable(null);
    setMsgs((prev) => [...prev, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: q, interactionId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        reply?: string;
        interactionId?: string;
        error?: string;
      };
      if (data.ok && data.reply) {
        setMsgs((prev) => [...prev, { role: "assistant", text: data.reply! }]);
        if (data.interactionId) setInteractionId(data.interactionId);
      } else {
        setUnavailable(data.error ?? "The assistant is unavailable right now.");
        setMsgs((prev) => [...prev, { role: "assistant", text: "(no answer)" }]);
      }
    } catch {
      setUnavailable("Could not reach the assistant.");
      setMsgs((prev) => [...prev, { role: "assistant", text: "(no answer)" }]);
    } finally {
      setBusy(false);
    }
  }

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    right: 20,
    bottom: 84,
    width: "min(380px, calc(100vw - 32px))",
    height: "min(540px, calc(100vh - 120px))",
    background: "var(--surface)",
    border: "1px solid var(--fg-4)",
    borderRadius: 14,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    zIndex: 1200,
    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  };

  return (
    <>
      {open && (
        <div style={panelStyle} role="dialog" aria-label="GEBO assistant">
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--fg-4)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 650, fontSize: "0.95rem" }}>GEBO assistant</div>
              <div style={{ fontSize: "0.72rem", color: "var(--fg-3)" }}>
                Read-only. It finds and explains; it never touches your wallet.
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              style={{
                background: "none",
                border: "none",
                color: "var(--fg-3)",
                cursor: "pointer",
                fontSize: "1.1rem",
                padding: 4,
              }}
            >
              x
            </button>
          </div>

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {msgs.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--fg-2)" }}>
                  Ask about agents, categories, liveness or how hiring works. Try:
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{
                      textAlign: "left",
                      background: "var(--bg)",
                      border: "1px solid var(--fg-4)",
                      borderRadius: 10,
                      color: "var(--fg)",
                      padding: "8px 12px",
                      fontSize: "0.82rem",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {msgs.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  background: m.role === "user" ? "var(--accent)" : "var(--bg)",
                  color: m.role === "user" ? "#0c0e12" : "var(--fg)",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                  border: m.role === "user" ? "none" : "1px solid var(--fg-4)",
                }}
              >
                <Markdownish text={m.text} />
              </div>
            ))}

            {busy && (
              <div
                style={{
                  alignSelf: "flex-start",
                  fontSize: "0.82rem",
                  color: "var(--fg-3)",
                  padding: "4px 12px",
                }}
              >
                Checking the registry...
              </div>
            )}

            {unavailable && (
              <div
                style={{
                  alignSelf: "flex-start",
                  fontSize: "0.78rem",
                  color: "var(--fail)",
                  padding: "2px 12px",
                }}
              >
                {unavailable}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--fg-4)" }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about any agent or job..."
              aria-label="Message the GEBO assistant"
              style={{
                flex: 1,
                background: "var(--bg)",
                border: "1px solid var(--fg-4)",
                borderRadius: 8,
                color: "var(--fg)",
                padding: "9px 12px",
                fontSize: "0.85rem",
                fontFamily: "inherit",
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              style={{
                background: "var(--accent)",
                color: "#0c0e12",
                border: "none",
                borderRadius: 8,
                padding: "9px 14px",
                fontWeight: 600,
                cursor: busy || !input.trim() ? "default" : "pointer",
                opacity: busy || !input.trim() ? 0.5 : 1,
                fontFamily: "inherit",
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="gebo-assistant-btn"
        data-busy={busy ? "true" : "false"}
        aria-label={open ? "Close assistant" : "Open the GEBO assistant"}
        title="GEBO assistant"
      >
        <span style={{ position: "relative", display: "flex" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gebo-mark.png" alt="" width={30} height={30} />
          {busy && <span className="gebo-assistant-ring" />}
        </span>
      </button>
      <style>{WIDGET_CSS}</style>
    </>
  );
}
