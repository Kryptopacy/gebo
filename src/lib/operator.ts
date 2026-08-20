/**
 * Operator identity.
 *
 * The strongest measured finding: 120 sampled BSC agents resolved to only 21
 * distinct endpoint hosts, and in the newest cohort two hosts accounted for 87%
 * of registrations. 257,888 registered agents do not mean 257,888 suppliers.
 *
 * Ranking agents independently would therefore display apparent variety while
 * surfacing a handful of vendors. Operator identity makes that visible and
 * lets ranking cap how many slots one operator may occupy.
 */
import type { AgentDetail } from "./scan.ts";
import type { Endpoint } from "./probe.ts";

export type Operator = {
  /** Stable grouping key. */
  key: string;
  /** How the key was derived — host is stronger evidence than owner. */
  kind: "host" | "owner" | "unknown";
  host: string | null;
  registrableDomain: string | null;
  owner: string | null;
};

/**
 * Multi-label public suffixes we care about. This is a heuristic, not the
 * Public Suffix List — the limitation is disclosed in /methodology. Notably,
 * platform subdomains (*.vercel.app, *.fly.dev) SHOULD collapse to the
 * platform for infrastructure purposes but NOT for operator identity, since
 * different operators share them. Those are listed as "tenant suffixes".
 */
const MULTI_SUFFIX = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
  "co.jp", "co.kr", "com.br", "com.cn", "com.sg", "co.in", "com.mx",
  "ap-southeast-1.amazonaws.com", "s3.amazonaws.com",
]);

/**
 * Hosts where the subdomain identifies the *tenant*, not the platform. For
 * these, operator identity is the full hostname — collapsing them would merge
 * unrelated operators into one.
 */
const TENANT_SUFFIX = [
  "vercel.app", "fly.dev", "netlify.app", "pages.dev", "onrender.com",
  "herokuapp.com", "railway.app", "workers.dev", "ngrok.io", "ngrok-free.app",
  "nip.io", "sslip.io", "amazonaws.com", "azurewebsites.net", "run.app",
  "github.io", "streamlit.app", "hf.space", "replit.app", "deno.dev",
];

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host; // bare IP

  // Tenant platforms: keep the tenant label so operators stay distinct.
  for (const suf of TENANT_SUFFIX) {
    if (host === suf) return host;
    if (host.endsWith("." + suf)) {
      const rest = host.slice(0, -(suf.length + 1)).split(".");
      const tenant = rest[rest.length - 1];
      return tenant ? `${tenant}.${suf}` : host;
    }
  }

  const parts = host.split(".");
  if (parts.length <= 2) return host;

  const last2 = parts.slice(-2).join(".");
  const last3 = parts.slice(-3).join(".");
  if (MULTI_SUFFIX.has(last3)) return parts.slice(-4).join(".") || last3;
  if (MULTI_SUFFIX.has(last2)) return last3;
  return last2;
}

export function operatorOf(d: AgentDetail, endpoints: Endpoint[]): Operator {
  for (const ep of endpoints) {
    try {
      const host = new URL(ep.url).hostname.toLowerCase();
      const dom = registrableDomain(host);
      return {
        key: `host:${dom}`,
        kind: "host",
        host,
        registrableDomain: dom,
        owner: d.owner_address ?? null,
      };
    } catch { /* try the next endpoint */ }
  }

  if (d.owner_address) {
    return {
      key: `owner:${d.owner_address.toLowerCase()}`,
      kind: "owner",
      host: null,
      registrableDomain: null,
      owner: d.owner_address,
    };
  }

  return { key: "unknown", kind: "unknown", host: null, registrableDomain: null, owner: null };
}
