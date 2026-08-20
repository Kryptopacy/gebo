/**
 * Registration linting.
 *
 * Motivated by measurement, not theory: 22 of 120 sampled BSC agents (18%)
 * registered an endpoint URL containing an unsubstituted template variable
 * (`.../agents/{agentId}/card`). Those registrations are unusable by any
 * client, and nothing in the ecosystem currently flags them.
 *
 * Defects are surfaced, never silently dropped — a silent drop is
 * indistinguishable from a bug and destroys the data-quality claim.
 */
import type { AgentDetail } from "./scan.ts";
import type { Endpoint } from "./probe.ts";

export type Defect = {
  code:
    | "template_var"
    | "bad_scheme"
    | "loopback_host"
    | "private_host"
    | "bare_ip"
    | "placeholder_domain"
    | "no_endpoint"
    | "unparseable_url"
    | "empty_name"
    | "no_trust_model";
  severity: "fatal" | "major" | "minor";
  detail: string;
};

export type LintResult = {
  defects: Defect[];
  /** fatal = cannot possibly be called by any client */
  usable: boolean;
};

const TEMPLATE = /\{[^}]*\}|<[^>]*>|\$\{[^}]*\}|(^|\/):[A-Za-z_][A-Za-z0-9_]*/;
const PLACEHOLDER_HOSTS = new Set([
  "example.com", "example.org", "example.net", "test.com",
  "localhost", "foo.com", "bar.com", "yourdomain.com", "domain.com",
]);
const PRIVATE_V4 = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
const BARE_IP = /^\d{1,3}(\.\d{1,3}){3}$/;

export function lintUrl(raw: string): Defect[] {
  const out: Defect[] = [];

  if (TEMPLATE.test(raw)) {
    out.push({
      code: "template_var",
      severity: "fatal",
      detail: `unsubstituted template variable in URL: ${raw.slice(0, 120)}`,
    });
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    out.push({ code: "unparseable_url", severity: "fatal", detail: raw.slice(0, 120) });
    return out;
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    out.push({ code: "bad_scheme", severity: "fatal", detail: u.protocol });
  }

  const host = u.hostname.toLowerCase();

  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local") || host.endsWith(".localhost")) {
    out.push({ code: "loopback_host", severity: "fatal", detail: host });
  } else if (PRIVATE_V4.test(host)) {
    out.push({ code: "private_host", severity: "fatal", detail: `RFC1918 address: ${host}` });
  } else if (BARE_IP.test(host)) {
    // Reachable, but no TLS identity and no domain to verify ownership against.
    out.push({ code: "bare_ip", severity: "major", detail: host });
  }

  if (PLACEHOLDER_HOSTS.has(host)) {
    out.push({ code: "placeholder_domain", severity: "fatal", detail: host });
  }

  return out;
}

export function lintRegistration(d: AgentDetail, endpoints: Endpoint[]): LintResult {
  const defects: Defect[] = [];

  if (!endpoints.length) {
    defects.push({
      code: "no_endpoint",
      severity: "fatal",
      detail: "declares a protocol but exposes no endpoint URL",
    });
  }

  for (const ep of endpoints) defects.push(...lintUrl(ep.url));

  if (!d.name || !d.name.trim()) {
    defects.push({ code: "empty_name", severity: "minor", detail: "no name" });
  }

  if (!d.supported_trust_models?.length) {
    // Per ERC-8004, absent supportedTrust means discovery-only, no trust claim.
    defects.push({
      code: "no_trust_model",
      severity: "minor",
      detail: "no supportedTrust declared — discovery only, makes no trust claim",
    });
  }

  return { defects, usable: !defects.some((x) => x.severity === "fatal") };
}
