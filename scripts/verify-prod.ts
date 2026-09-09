/**
 * Pre-submission production check. Fails loudly; fixes nothing.
 *
 * "Functional and publicly accessible during judging" is a hard requirement, so this
 * fetches the deployed site as a judge would and asserts the failure modes this
 * project has actually shipped before: fabricated zeros, degraded notices rendered as
 * data, NaN/Infinity, mojibake from CP1252 writes, and cron endpoints left open.
 *
 * Run: npm run verify:prod
 */
import "dotenv/config";

const BASE = (process.env.GEBO_PROD_URL ?? "https://gebo-bsc.vercel.app").replace(/\/+$/, "");

type Check = { route: string; must?: RegExp[]; mustNot?: RegExp[] };

/** Patterns that mean a page is lying or broken, regardless of which page it is. */
const NEVER = [
  /\bNaN\b/,
  /\bInfinity\b/,
  /undefined<\/,/,
  /â€|Â|ï¿½/,               // CP1252 mojibake, previously committed into a .tsx
  /could not be measured/i,  // the honest fallback: real, but not acceptable in prod
  /could not be read/i,
];

const CHECKS: Check[] = [
  { route: "/", must: [/agents/i, /registered/i] },
  { route: "/live", must: [/How long an answer takes/, /probes/i] },
  { route: "/compare", must: [/Tasks run both ways|No task has been run/] },
  { route: "/authority", must: [/Altana Keystore/, /Agentic Wallet/] },
  { route: "/methodology", must: [/What is measured/] },
  { route: "/search", must: [/Search|capability/i] },
  { route: "/shortlist", must: [/Nothing to compare yet|the judgement stays yours/i] },
  { route: "/shortlist?ids=259573,265375", must: [/uptime 7d|No probe yet/] },
  { route: "/c/health", must: [/health/i] },
  { route: "/a/265375", must: [/Track record/] },
];

/** Endpoints that must refuse an unauthenticated caller. */
const MUST_REFUSE = ["/api/cron/probe", "/api/cron/emerging", "/api/cron/classify"];

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL  ${msg}`); };
const pass = (msg: string) => console.log(`  ok    ${msg}`);

console.log(`\n  Production check: ${BASE}\n`);

for (const c of CHECKS) {
  try {
    const res = await fetch(BASE + c.route, {
      headers: { "user-agent": "gebo-preflight" },
      signal: AbortSignal.timeout(45_000),
      redirect: "follow",
    });
    const html = await res.text();

    if (!res.ok) { fail(`${c.route} HTTP ${res.status}`); continue; }
    if (html.length < 3000) { fail(`${c.route} only ${html.length} bytes - likely an error shell`); continue; }

    const bad = NEVER.filter((re) => re.test(html));
    if (bad.length) { fail(`${c.route} contains ${bad.map((b) => b.source).join(", ")}`); continue; }

    const missing = (c.must ?? []).filter((re) => !re.test(html));
    if (missing.length) { fail(`${c.route} missing ${missing.map((m) => m.source).join(", ")}`); continue; }

    pass(`${c.route}  ${(html.length / 1024).toFixed(0)} kB`);
  } catch (e: any) {
    fail(`${c.route} ${String(e?.message ?? e).slice(0, 60)}`);
  }
}

console.log("");
for (const p of MUST_REFUSE) {
  try {
    const res = await fetch(BASE + p, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 401 || res.status === 403) pass(`${p} refuses (HTTP ${res.status})`);
    else fail(`${p} returned HTTP ${res.status} - should be 401`);
  } catch (e: any) {
    fail(`${p} ${String(e?.message ?? e).slice(0, 50)}`);
  }
}

// The reference agent must be reachable and must answer, or it is no better than the
// five listings that advertise 127.0.0.1.
console.log("");
try {
  const cardRes = await fetch(`${BASE}/api/agent/health/card`, { signal: AbortSignal.timeout(30_000) });
  const card = (await cardRes.json()) as { url?: string };
  if (!cardRes.ok) fail(`agent card HTTP ${cardRes.status}`);
  else if (typeof card.url !== "string" || /127\.0\.0\.1|localhost/.test(card.url)) {
    fail(`agent card advertises an unreachable endpoint: ${card.url}`);
  } else {
    pass(`agent card advertises ${card.url}`);

    const started = Date.now();
    const a2a = await fetch(card.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "message/send",
        params: { message: { role: "user", messageId: "preflight", parts: [{ kind: "text", text: "health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055" }] } },
      }),
    });
    const body = (await a2a.json()) as { result?: unknown; error?: unknown };
    const ms = Date.now() - started;
    if (body.error || !body.result) fail(`agent answered with an error: ${JSON.stringify(body.error).slice(0, 90)}`);
    else {
      const text = JSON.stringify(body.result);
      if (!/healthFactor/.test(text)) fail(`agent reply carries no healthFactor`);
      else pass(`agent answered in ${ms} ms with a health factor`);
    }
  }
} catch (e: any) {
  fail(`reference agent ${String(e?.message ?? e).slice(0, 60)}`);
}

console.log(
  failures === 0
    ? `\n  All checks passed. Production is presentable.\n`
    : `\n  ${failures} check(s) failed. Fix before submitting.\n`,
);
process.exit(failures === 0 ? 0 : 1);
