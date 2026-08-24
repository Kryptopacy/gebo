/**
 * Endpoint probing with protocol validation.
 *
 * The first-pass prober only checked for a 2xx, which measured "a server served
 * bytes" and nothing about whether an agent exists behind it. That overstated
 * health and is corrected here: A2A endpoints must return a parseable Agent
 * Card, and MCP endpoints must complete a JSON-RPC `initialize` handshake.
 *
 * Outcome is graded, not boolean:
 *   validated  - spoke the protocol correctly. This is the only real signal.
 *   responded  - 2xx, but did not validate as an agent interface.
 *   failed     - no usable response, with the reason classified.
 *
 * Error classes are kept distinct because "DNS does not resolve" (abandoned)
 * is a different fact from "timed out" (possibly alive, unreachable from here).
 */
import type { AgentDetail } from "./scan.ts";

export type EndpointKind = "a2a" | "mcp" | "web";
export type Endpoint = { kind: EndpointKind; url: string };

export type ErrClass =
  | "ok" | "http_4xx" | "http_5xx" | "dns" | "timeout" | "tls"
  /**
   * The card is well formed but advertises an endpoint no client can reach -
   * loopback, RFC1918, or a non-HTTP scheme. Its own class because the operator
   * fix is specific and the generic card-shape message would misdirect them.
   */
  | "unreachable_endpoint"
  | "refused" | "reset" | "bad_url" | "non_json" | "other";

export type ProbeOutcome = {
  kind: EndpointKind;
  url: string;
  /** graded result */
  grade: "validated" | "responded" | "failed";
  httpStatus: number | null;
  rttMs: number;
  errClass: ErrClass;
  errDetail: string | null;
  /** protocol-level evidence, when we got any */
  evidence: Record<string, unknown> | null;
};

const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 8000);
const UA = "gebo-prober/0.2 (+agent liveness measurement; BNB Smart Chain)";

export function pickEndpoints(d: AgentDetail): Endpoint[] {
  const out: Endpoint[] = [];
  if (d.a2a_endpoint) out.push({ kind: "a2a", url: d.a2a_endpoint });
  if (d.mcp_server) out.push({ kind: "mcp", url: d.mcp_server });
  if (d.agent_url) out.push({ kind: "web", url: d.agent_url });
  return out;
}

function classify(e: any): { cls: ErrClass; detail: string } {
  const msg = String(e?.cause?.code ?? e?.code ?? e?.name ?? e?.message ?? e);
  const m = msg.toLowerCase();
  if (m.includes("enotfound") || m.includes("eai_again") || m.includes("getaddrinfo")) return { cls: "dns", detail: msg };
  if (m.includes("timeout") || m.includes("abort")) return { cls: "timeout", detail: msg };
  if (m.includes("econnrefused")) return { cls: "refused", detail: msg };
  if (m.includes("econnreset") || m.includes("socket hang up")) return { cls: "reset", detail: msg };
  if (m.includes("cert") || m.includes("tls") || m.includes("ssl") || m.includes("altname") || m.includes("depth_zero")) return { cls: "tls", detail: msg };
  if (m.includes("invalid url") || m.includes("failed to parse")) return { cls: "bad_url", detail: msg };
  return { cls: "other", detail: msg.slice(0, 160) };
}

/**
 * Keep only detail worth storing.
 *
 * Raw transport output leaked into a human-facing column: a bare "23" from an
 * errno, and whole Cloudflare error-page bodies from a 502. Neither means
 * anything to a reader, and the classified outcome already carries the meaning,
 * so anything that is not prose-shaped is dropped rather than persisted.
 */
function cleanDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const d = String(detail).replace(/\s+/g, " ").trim();
  if (d.length < 8) return null;                          // bare codes
  if (/^[\d\s.,:-]+$/.test(d)) return null;                // numbers only
  if (/^[[{"]/.test(d)) return null;                       // JSON or quoted payload
  if (/<\/?[a-z]+[\s>]/i.test(d)) return null;             // HTML error page
  if (d.includes("cloudflare.com/support")) return null;   // vendor error page
  if (!/[a-z]{3}/i.test(d)) return null;                   // no real words
  return d.slice(0, 160);
}

/**
 * Is the endpoint the card ADVERTISES reachable by anyone other than its author?
 *
 * Found by measurement, not review. Two agents graded VERIFIED serve a perfectly
 * good card from agents.chainhelix.io and declare, inside it:
 *
 *   "url": "http://127.0.0.1:9104/"
 *
 * A2A clients are supposed to send message/send to that address. No third party can
 * reach it, so the agent is unhireable by anyone but the machine that runs it - and
 * we graded it VERIFIED because the CARD answered.
 *
 * lint.ts already treats a loopback host as a FATAL registration defect, and has
 * since the beginning. It was simply pointed at the wrong URL: the registry's
 * declared endpoint, which is public and fine. The one that matters for hiring is
 * this one, and nothing was checking it.
 *
 * So VERIFIED meant "the card is reachable" rather than "the agent is reachable",
 * which is precisely the gap between declared and actual that this project exists
 * to close.
 */
export function cardEndpointDefect(declared: unknown): string | null {
  if (typeof declared !== "string" || !declared.trim()) return null;

  let u: URL;
  try {
    u = new URL(declared);
  } catch {
    return `card declares an unparseable endpoint: ${declared.slice(0, 60)}`;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return `card endpoint is not HTTP: ${u.protocol}`;
  }

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return `card endpoint is loopback, unreachable by any client: ${u.origin}`;
  }
  if (host.endsWith(".local") || host.endsWith(".localhost")) {
    return `card endpoint is a local-only name: ${u.origin}`;
  }
  // RFC1918 and link-local. Same list as lint.ts, kept literal rather than shared
  // because probe.ts must stay dependency-light.
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return `card endpoint is a private address, unreachable from outside its network: ${u.origin}`;
  }
  return null;
}

/** Does this JSON look like an A2A Agent Card? */
function validateAgentCard(json: any): { ok: boolean; evidence: Record<string, unknown> } {
  if (!json || typeof json !== "object") return { ok: false, evidence: { reason: "not an object" } };
  const hasName = typeof json.name === "string" && json.name.length > 0;
  const hasSkills = Array.isArray(json.skills);
  const hasCaps = json.capabilities !== undefined;
  const hasUrl = typeof json.url === "string";
  const hasVersion = typeof json.version === "string" || typeof json.protocolVersion === "string";

  /**
   * A card advertising an endpoint nobody can call is not a valid A2A card.
   *
   * Treated as failing validation rather than as a warning, because the
   * consequence is total: every hire attempt from every client fails. Grading it
   * VERIFIED would publish a working agent that cannot be worked with.
   */
  const endpointDefect = cardEndpointDefect(json.url);

  // Require a name plus at least one structural A2A field, and a usable endpoint
  // if one is declared at all.
  const ok = hasName && (hasSkills || hasCaps || hasUrl) && !endpointDefect;

  /**
   * Capture the skill text, not merely its count.
   *
   * This is the agent's own statement of what it can do, and it is the only
   * capability signal in the ecosystem that is neither a name nor marketing
   * copy. Discarding it - as an earlier version did - left classification
   * matching against names like "premium" and "Professor".
   */
  const skillNames: string[] = [];
  if (hasSkills) {
    for (const s of json.skills.slice(0, 40)) {
      if (typeof s === "string") { skillNames.push(s.slice(0, 120)); continue; }
      if (s && typeof s === "object") {
        const parts = [s.name, s.id, s.description].filter((x) => typeof x === "string" && x.length);
        if (parts.length) skillNames.push(parts.join(" - ").slice(0, 200));
        if (Array.isArray(s.tags)) {
          for (const t of s.tags.slice(0, 8)) if (typeof t === "string") skillNames.push(t.slice(0, 60));
        }
      }
    }
  }

  return {
    ok,
    evidence: {
      name: hasName ? String(json.name).slice(0, 120) : null,
      description: typeof json.description === "string" ? json.description.slice(0, 1200) : null,
      skillCount: hasSkills ? json.skills.length : null,
      skills: skillNames.length ? skillNames : null,
      hasCapabilities: hasCaps,
      hasUrl,
      hasVersion,
      version: typeof json.version === "string" ? json.version : (json.protocolVersion ?? null),
      /** The endpoint the card tells clients to call, and why it is unusable. */
      declaredEndpoint: typeof json.url === "string" ? json.url.slice(0, 200) : null,
      endpointDefect,
    },
  };
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  return fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": UA, ...(init.headers ?? {}) },
  });
}

async function probeA2A(url: string): Promise<Partial<ProbeOutcome>> {
  const res = await fetchWithTimeout(url, { method: "GET", headers: { accept: "application/json" } });
  const status = res.status;
  if (!res.ok) {
    return { grade: "failed", httpStatus: status, errClass: status >= 500 ? "http_5xx" : "http_4xx", errDetail: res.statusText };
  }
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch {
    return { grade: "responded", httpStatus: status, errClass: "non_json", errDetail: cleanDetail(text), evidence: null };
  }
  const v = validateAgentCard(json);
  /**
   * Report an unreachable declared endpoint as its own class.
   *
   * "2xx JSON but not a recognisable A2A Agent Card" would be actively misleading
   * here: the card is well formed and perfectly recognisable. What is wrong is that
   * it points clients at an address only its author can reach. The operator can act
   * on that message; the generic one would send them hunting through their schema.
   */
  const defect = v.evidence.endpointDefect as string | null | undefined;
  return {
    grade: v.ok ? "validated" : "responded",
    httpStatus: status,
    errClass: v.ok ? "ok" : defect ? "unreachable_endpoint" : "ok",
    errDetail: v.ok
      ? null
      : defect
        ? defect
        : "2xx JSON but not a recognisable A2A Agent Card",
    evidence: v.evidence,
  };
}

async function probeMCP(url: string): Promise<Partial<ProbeOutcome>> {
  // MCP Streamable HTTP: POST JSON-RPC initialize.
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "gebo-prober", version: "0.2" },
    },
  };
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  const status = res.status;
  const text = await res.text();

  if (!res.ok) {
    return { grade: "failed", httpStatus: status, errClass: status >= 500 ? "http_5xx" : "http_4xx", errDetail: cleanDetail(text) };
  }

  // Response may be plain JSON or an SSE frame ("data: {...}").
  let json: any = null;
  const sse = text.match(/^data:\s*(\{[\s\S]*\})\s*$/m);
  try { json = JSON.parse(sse ? sse[1]! : text); } catch { /* leave null */ }

  if (!json) {
    return { grade: "responded", httpStatus: status, errClass: "non_json", errDetail: cleanDetail(text), evidence: null };
  }
  const result = json.result;
  const ok = !!result && (typeof result.protocolVersion === "string" || !!result.serverInfo || !!result.capabilities);
  return {
    grade: ok ? "validated" : "responded",
    httpStatus: status,
    errClass: "ok",
    errDetail: ok ? null : json.error ? `jsonrpc error: ${String(json.error?.message).slice(0, 90)}` : "2xx but no MCP initialize result",
    evidence: ok
      ? {
          protocolVersion: result.protocolVersion ?? null,
          serverName: result.serverInfo?.name ?? null,
          serverVersion: result.serverInfo?.version ?? null,
          transport: sse ? "sse" : "json",
        }
      : { rpcError: json.error?.message ?? null },
  };
}

async function probeWeb(url: string): Promise<Partial<ProbeOutcome>> {
  const res = await fetchWithTimeout(url, { method: "GET", headers: { accept: "*/*" } });
  return res.ok
    ? { grade: "responded", httpStatus: res.status, errClass: "ok", errDetail: "reachable web page - no agent protocol asserted", evidence: null }
    : { grade: "failed", httpStatus: res.status, errClass: res.status >= 500 ? "http_5xx" : "http_4xx", errDetail: res.statusText };
}

export async function probeEndpoint(ep: Endpoint): Promise<ProbeOutcome> {
  const base: ProbeOutcome = {
    kind: ep.kind, url: ep.url, grade: "failed",
    httpStatus: null, rttMs: 0, errClass: "other", errDetail: null, evidence: null,
  };

  try { new URL(ep.url); } catch {
    return { ...base, errClass: "bad_url", errDetail: cleanDetail(ep.url) };
  }

  const t0 = performance.now();
  try {
    const r =
      ep.kind === "a2a" ? await probeA2A(ep.url)
      : ep.kind === "mcp" ? await probeMCP(ep.url)
      : await probeWeb(ep.url);
    return { ...base, ...r, rttMs: Math.round(performance.now() - t0) };
  } catch (e) {
    const { cls, detail } = classify(e);
    return { ...base, rttMs: Math.round(performance.now() - t0), errClass: cls, errDetail: cleanDetail(detail) };
  }
}
