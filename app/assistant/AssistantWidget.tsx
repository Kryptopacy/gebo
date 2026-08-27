"use client";

/**
 * Floating product-assistant widget, mounted in the root layout so it is
 * available on every page. The assistant is read-only: it navigates and
 * explains; anything that touches a wallet happens in the hire flow, never
 * here.
 *
 * DRAGGABLE. The button (and the panel, by its header) can be grabbed and
 * moved anywhere on screen; the spot persists in localStorage. The button's
 * position is the single source of truth and the panel anchors to it,
 * clamped to the viewport. A 6px movement threshold separates a drag from a
 * click, so tapping still toggles the panel. Pointer events cover mouse and
 * touch; touch-action:none stops the page scrolling mid-drag.
 *
 * Styles live here rather than in globals.css so the widget is self-contained.
 * Class names are prefixed so they cannot collide. All animation is off under
 * prefers-reduced-motion.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";

type Msg = { role: "user" | "assistant"; text: string };
type Pos = { x: number; y: number };

const SUGGESTIONS = [
  "What agents can watch my Venus lending position?",
  "How does GEBO decide an agent is verified?",
  "Show me the difference between rebalancing and grid trading",
  "How many registered agents are actually hireable?",
];

const BTN_SIZE = 52;
const PANEL_W = 380;
const PANEL_H = 540;
const MARGIN = 8;
const GAP = 12;
const DRAG_THRESHOLD = 6;
const POS_KEY = "gebo-assistant-pos";

const WIDGET_CSS = `
.gebo-assistant-btn {
  position: fixed; right: 20px; bottom: 20px; z-index: 1200;
  width: 52px; height: 52px; border-radius: 999px;
  /* --ink-850, not a custom token: this file once used var(--surface), which
     no theme block defines, so the background resolved to nothing and the
     widget rendered transparent over whatever sat beneath it. */
  background: var(--ink-850);
  border: 1px solid var(--fg-4);
  cursor: grab; padding: 0;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(0,0,0,0.28);
  transition: box-shadow 0.2s ease, filter 0.2s ease;
  animation: gebo-enter 0.5s ease-out, gebo-breathe 3.4s ease-in-out 0.5s infinite;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.gebo-assistant-btn:hover { filter: brightness(1.12); box-shadow: 0 6px 20px rgba(0,0,0,0.38); }
.gebo-assistant-btn[data-busy="true"] { animation-play-state: paused; }
.gebo-assistant-btn img { width: 30px; height: 30px; pointer-events: none; }
.gebo-assistant-ring {
  position: absolute; inset: -3px; border-radius: 999px;
  border: 2px solid var(--accent); border-top-color: transparent;
  animation: gebo-spin 0.9s linear infinite;
}
.gebo-assistant-head {
  cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
}
@keyframes gebo-enter { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
@keyframes gebo-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes gebo-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .gebo-assistant-btn { animation: none; }
  .gebo-assistant-ring { animation: none; }
}
`;

function viewport() {
  return {
    w: typeof window === "undefined" ? 1280 : window.innerWidth,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  };
}

/** Default resting spot: bottom-right corner, matching the CSS pre-mount. */
function defaultPos(): Pos {
  const { w, h } = viewport();
  return { x: w - BTN_SIZE - 20, y: h - BTN_SIZE - 20 };
}

function clampPos(p: Pos): Pos {
  const { w, h } = viewport();
  return {
    x: Math.min(Math.max(p.x, MARGIN), Math.max(MARGIN, w - BTN_SIZE - MARGIN)),
    y: Math.min(Math.max(p.y, MARGIN), Math.max(MARGIN, h - BTN_SIZE - MARGIN)),
  };
}

/** Minimal markdown: links, bold, line breaks. Nothing else is interpreted. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
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
  // null until mount: the CSS class holds the default bottom-right spot so
  // server and first client render match, then stored/default pos takes over.
  const [pos, setPos] = useState<Pos | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; base: Pos; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
        if (typeof p.x === "number" && typeof p.y === "number") {
          setPos(clampPos({ x: p.x, y: p.y }));
          return;
        }
      }
    } catch {
      // unreadable stored position falls through to the default
    }
    setPos(defaultPos());
  }, []);

  // A stored spot can end up off-screen after a window resize.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clampPos(p) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy, open]);

  // ── drag ────────────────────────────────────────────────────────────────
  // Works on both the button and the panel header; both move the same
  // underlying position, so the pair stays one unit.

  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, base: pos ?? defaultPos(), moved: false };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // capture is best-effort; tracking still works within the element
      }
    },
    [pos],
  );

  const onDragMove = useCallback((e: ReactPointerEvent) => {
    const st = dragRef.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.moved && Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD) return;
    st.moved = true;
    setPos(clampPos({ x: st.base.x + dx, y: st.base.y + dy }));
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent) => {
    const st = dragRef.current;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (st?.moved) {
      suppressClickRef.current = true;
      setPos((p) => {
        const c = clampPos(p ?? defaultPos());
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(c));
        } catch {
          // private mode: position just will not persist
        }
        return c;
      });
    }
  }, []);

  // ── chat ────────────────────────────────────────────────────────────────

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

  // Panel anchors to the button: right edges aligned, panel above the button.
  // Clamped to the viewport, flipping below the button when there is no room.
  const panelStyle: CSSProperties = (() => {
    const base: CSSProperties = {
      width: `min(${PANEL_W}px, calc(100vw - 32px))`,
      height: `min(${PANEL_H}px, calc(100vh - 120px))`,
      // Opaque and drawn from tokens the theme actually defines. The panel
      // floats above the masthead (z-index 20 here vs the widget's 1200), so
      // if this background is ever transparent again the nav dropdown shows
      // straight through and both layers read as one garbled menu.
      background: "var(--ink-850)",
      border: "1px solid var(--fg-4)",
      borderRadius: 14,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      zIndex: 1200,
      boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
    };
    if (!pos) {
      return { ...base, position: "fixed" as const, right: 20, bottom: 84 };
    }
    const { w, h } = viewport();
    const pw = Math.min(PANEL_W, w - 32);
    const ph = Math.min(PANEL_H, h - 120);
    let left = pos.x + BTN_SIZE - pw;
    let top = pos.y - ph - GAP;
    if (top < MARGIN) top = pos.y + BTN_SIZE + GAP;
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, w - pw - MARGIN));
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, h - ph - MARGIN));
    return { ...base, position: "fixed" as const, left, top };
  })();

  const btnStyle: CSSProperties | undefined = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
    : undefined;

  return (
    <>
      {open && (
        <div style={panelStyle} role="dialog" aria-label="GEBO assistant">
          <div
            className="gebo-assistant-head"
            onPointerDown={startDrag}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title="Drag to move the assistant"
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--fg-4)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/gebo-mark.png" alt="" width={22} height={22} />
              <div>
                <div style={{ fontWeight: 650, fontSize: "0.95rem" }}>GEBO assistant</div>
                <div style={{ fontSize: "0.72rem", color: "var(--fg-3)" }}>
                  Read-only. It finds and explains; it never touches your wallet.
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close assistant"
              style={{
                background: "none",
                border: "none",
                color: "var(--fg-2)",
                cursor: "pointer",
                fontSize: "1.3rem",
                lineHeight: 1,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              ×
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
                      // --ink-800: one step up from the --ink-850 panel so the
                      // chips read as raised, not transparent. Was var(--bg),
                      // which no theme block defines.
                      background: "var(--ink-800)",
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
                  // --ink-800 for assistant bubbles: same reasoning as the
                  // suggestion chips; var(--bg) here made bubbles transparent.
                  background: m.role === "user" ? "var(--accent)" : "var(--ink-800)",
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
                background: "var(--ink-850)",
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

      {!open && (
        <button
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            setOpen((v) => !v);
          }}
          onPointerDown={startDrag}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="gebo-assistant-btn"
          style={btnStyle}
          data-busy={busy ? "true" : "false"}
          aria-label={open ? "Close assistant" : "Open the GEBO assistant"}
          title="GEBO assistant (drag to move)"
        >
        <span style={{ position: "relative", display: "flex" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gebo-mark.png" alt="" width={30} height={30} />
          {busy && <span className="gebo-assistant-ring" />}
        </span>
      </button>
      )}
      <style>{WIDGET_CSS}</style>
    </>
  );
}
