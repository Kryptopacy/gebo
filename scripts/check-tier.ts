/**
 * Determine which rate-limit tier the API key is actually on.
 *
 * The Pro grant (500/min, 100k/day) is applied manually by AltLayer after form
 * submission, so the key may still be on anonymous (10/min, 100/day) or
 * free_api (30/min, 1000/day). Knowing which changes the ingest plan
 * completely, so measure it rather than assume.
 */
import "dotenv/config";

const BASE = process.env.EIGHT004SCAN_BASE_URL ?? "https://8004scan.io/api/v1/public";
const KEY = process.env.EIGHT004SCAN_API_KEY;

const TIERS: Record<string, string> = {
  "10": "anonymous  (10/min, 100/day)",
  "30": "free_api   (30/min, 1,000/day)",
  "100": "basic     (100/min, 10,000/day)",
  "500": "pro       (500/min, 100,000/day)",
  "2000": "enterprise (2000/min, unlimited)",
};

async function call(withKey: boolean) {
  const res = await fetch(`${BASE}/chains`, {
    headers: { accept: "application/json", ...(withKey && KEY ? { "X-API-Key": KEY } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const h = (n: string) => res.headers.get(n);
  return {
    status: res.status,
    limit: h("x-ratelimit-limit"),
    remaining: h("x-ratelimit-remaining"),
    reset: h("x-ratelimit-reset"),
    body: res.status !== 200 ? (await res.text()).slice(0, 220) : null,
  };
}

console.log(`\n  key present: ${KEY ? `yes (${KEY.slice(0, 12)}…)` : "NO"}`);
console.log("  waiting 65s for the per-minute window to roll...\n");
await new Promise((r) => setTimeout(r, 65_000));

for (const withKey of [true, false]) {
  const r = await call(withKey);
  const tier = r.limit ? (TIERS[r.limit] ?? `unknown limit=${r.limit}`) : "no header";
  console.log(`  ${withKey ? "WITH key   " : "WITHOUT key"}  status=${r.status}`);
  console.log(`     limit=${r.limit ?? "-"}  remaining=${r.remaining ?? "-"}  reset=${r.reset ?? "-"}`);
  console.log(`     tier: ${tier}`);
  if (r.body) console.log(`     body: ${r.body}`);
  console.log("");
  await new Promise((res) => setTimeout(res, 3000));
}
