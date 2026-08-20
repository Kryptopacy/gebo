/**
 * Endpoint probing with protocol validation.
 *
 * The first-pass prober only checked for a 2xx, which measured "a server served
 * bytes" and nothing about whether an agent exists behind it. That overstated
 * health and is corrected here: A2A endpoints must return a parseable Agent
 * Card, and MCP endpoints must complete a JSON-RPC `initialize` handshake.
 *
 * Outcome is graded, not boolean:
 *   validated  — spoke the protocol correctly. This is the only real signal.
 *   responded  — 2xx, but did not validate as an agent interface.
 *   failed     — no usable response, with the reason classified.
 *
 * Error classes are kept distinct because "DNS does not resolve" (abandoned)
 * is a different fact from "timed out" (possibly alive, unreachable from here).
 */
import type { AgentDetail } from "./scan.ts";

export type EndpointKind = "a2a" | "mcp" | "web";
export type Endpoint = { kind: EndpointKind; url: string };

export type ErrClass =
  | "ok" | "http_4xx" | "http_5xx" | "dns" | "timeout" | "tls"
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

/** Does this JSON look like an A2A Agent Card? */
function validateAgentCard(json: any): { ok: boolean; evidence: Record<string, unknown> } {
  if (!json || typeof json !== "object") return { ok: false, evidence: { reason: "not an object" } };
  const hasName = typeof json.name === "string" && json.name.length > 0;
  const hasSkills = Array.isArray(json.skills);
  const hasCaps = json.capabilities !== undefined;
  const hasUrl = typeof json.url === "string";
  const hasVersion = typeof json.version === "string" || typeof json.protocolVersion === "string";
  // Require a name plus at least one structural A2A field.
  const ok = hasName && (hasSkills || hasCaps || hasUrl);
  return {
    ok,
    evidence: {
      name: hasName ? String(json.name).slice(0, 80) : null,
      skills: hasSkills ? json.skills.length : null,
      hasCapabilities: hasCaps,
      hasUrl,
      hasVersion,
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
    return { grade: "responded", httpStatus: status, errClass: "non_json", errDetail: text.slice(0, 100), evidence: null };
  }
  const v = validateAgentCard(json);
  return {
    grade: v.ok ? "validated" : "responded",
    httpStatus: status,
    errClass: "ok",
    errDetail: v.ok ? null : "2xx JSON but not a recognisable A2A Agent Card",
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
    return { grade: "failed", httpStatus: status, errClass: status >= 500 ? "http_5xx" : "http_4xx", errDetail: text.slice(0, 120) };
  }

  // Response may be plain JSON or an SSE frame ("data: {...}").
  let json: any = null;
  const sse = text.match(/^data:\s*(\{[\s\S]*\})\s*$/m);
  try { json = JSON.parse(sse ? sse[1]! : text); } catch { /* leave null */ }

  if (!json) {
    return { grade: "responded", httpStatus: status, errClass: "non_json", errDetail: text.slice(0, 100), evidence: null };
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
    ? { grade: "responded", httpStatus: res.status, errClass: "ok", errDetail: "reachable web page — no agent protocol asserted", evidence: null }
    : { grade: "failed", httpStatus: res.status, errClass: res.status >= 500 ? "http_5xx" : "http_4xx", errDetail: res.statusText };
}

export async function probeEndpoint(ep: Endpoint): Promise<ProbeOutcome> {
  const base: ProbeOutcome = {
    kind: ep.kind, url: ep.url, grade: "failed",
    httpStatus: null, rttMs: 0, errClass: "other", errDetail: null, evidence: null,
  };

  try { new URL(ep.url); } catch {
    return { ...base, errClass: "bad_url", errDetail: ep.url.slice(0, 120) };
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
    return { ...base, rttMs: Math.round(performance.now() - t0), errClass: cls, errDetail: detail };
  }
}
