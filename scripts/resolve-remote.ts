/**
 * Second pass: resolve the registrations deferred by the local-only census.
 *
 * The census resolved `data:` URIs inline (zero network) and deferred every
 * https:/ipfs: pointer, because remote fetches are the bottleneck — ~105k of
 * them at three IPFS gateways deep would take many hours single-threaded.
 *
 * This pass fetches them with per-host politeness, because operator
 * concentration means a naive run would hammer a handful of domains hard
 * enough to look like an attack. singularry.org alone accounts for ~56% of all
 * declared endpoints.
 *
 * Resumable: appends to its own NDJSON and skips tokens already resolved.
 */
import "dotenv/config";
import { createReadStream, appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolveRegistration, endpointsFromRegistration } from "../src/lib/registry.ts";
import { lintUrl } from "../src/lib/lint.ts";
import { registrableDomain } from "../src/lib/operator.ts";

const IN = "data/registry-bsc.ndjson";
const OUT = "data/registry-remote.ndjson";
const CONCURRENCY = Number(process.env.RESOLVE_CONCURRENCY ?? 24);
const HOST_GAP_MS = Number(process.env.HOST_GAP_MS ?? 220);
const LIMIT = Number(process.argv.includes("--limit") ? process.argv[process.argv.indexOf("--limit") + 1] : 0);

mkdirSync("data", { recursive: true });

const done = new Set<string>();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).tokenId); } catch { /* partial */ }
  }
  console.log(`  resuming — ${done.size.toLocaleString()} already resolved`);
}

// ── collect the deferred queue ─────────────────────────────────────────────
type Pending = { tokenId: string; owner: string | null; tokenURI: string; uriScheme: string };
const queue: Pending[] = [];

{
  const rl = createInterface({ input: createReadStream(IN, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let r: any;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.resolved) continue;
    if (done.has(r.tokenId)) continue;
    if (!r.tokenURI) continue;
    if (r.uriScheme !== "https" && r.uriScheme !== "http" && r.uriScheme !== "ipfs") continue;
    queue.push({ tokenId: r.tokenId, owner: r.owner, tokenURI: r.tokenURI, uriScheme: r.uriScheme });
    if (LIMIT && queue.length >= LIMIT) break;
  }
}

console.log(`\n  deferred registrations to fetch: ${queue.length.toLocaleString()}`);

// Group by host so we can report concentration and pace politely.
const byHost = new Map<string, number>();
for (const q of queue) {
  try { byHost.set(new URL(q.tokenURI).hostname, (byHost.get(new URL(q.tokenURI).hostname) ?? 0) + 1); }
  catch { /* unparseable */ }
}
console.log(`  distinct metadata hosts: ${byHost.size}`);
for (const [h, n] of [...byHost].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${String(n).padStart(7)}  ${h}`);
}
console.log("");

// ── per-host pacing ────────────────────────────────────────────────────────
const hostNext = new Map<string, number>();
async function politeWait(host: string) {
  const now = Date.now();
  const next = Math.max(hostNext.get(host) ?? 0, now);
  hostNext.set(host, next + HOST_GAP_MS);
  const wait = next - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const tally = { ok: 0, fail: 0, withEndpoint: 0, callable: 0, fatal: 0 };
const t0 = Date.now();
let processed = 0;
let cursor = 0;

async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= queue.length) return;
    const q = queue[i]!;

    let host = "";
    try { host = new URL(q.tokenURI).hostname; } catch { /* ipfs handled inside */ }
    if (host) await politeWait(host);

    const res = await resolveRegistration(q.tokenURI, 9000);

    let row: any;
    if (!res.ok) {
      tally.fail++;
      row = { tokenId: q.tokenId, owner: q.owner, tokenURI: q.tokenURI, uriScheme: q.uriScheme,
              resolved: false, resolveError: res.error, callable: false, readAt: new Date().toISOString() };
    } else {
      tally.ok++;
      const eps = endpointsFromRegistration(res.file).map((e) => {
        let h: string | null = null, op: string | null = null;
        try { h = new URL(e.url).hostname; op = registrableDomain(h); } catch { /* bad url */ }
        return { ...e, host: h, operator: op, fatal: lintUrl(e.url).filter((d) => d.severity === "fatal").map((d) => d.code) };
      });
      if (eps.length) tally.withEndpoint++;
      if (eps.some((e) => e.fatal.length)) tally.fatal++;
      const callable = eps.some((e) => (e.kind === "a2a" || e.kind === "mcp") && e.fatal.length === 0);
      if (callable) tally.callable++;
      row = {
        tokenId: q.tokenId, owner: q.owner, tokenURI: q.tokenURI, uriScheme: q.uriScheme,
        resolved: true, resolveError: null,
        regName: res.file.name ?? null, regActive: res.file.active ?? null,
        x402: res.file.x402Support ?? null, supportedTrust: res.file.supportedTrust ?? null,
        endpoints: eps, callable, readAt: new Date().toISOString(),
      };
    }

    appendFileSync(OUT, JSON.stringify(row) + "\n", "utf8");
    processed++;

    if (processed % 250 === 0) {
      const mins = (Date.now() - t0) / 60_000;
      const rate = processed / Math.max(mins, 0.01);
      const eta = (queue.length - processed) / Math.max(rate, 1);
      console.log(`    ${processed.toLocaleString()}/${queue.length.toLocaleString()}  ${rate.toFixed(0)}/min  eta ${eta.toFixed(0)}m  ` +
        `ok=${tally.ok} fail=${tally.fail} endpoints=${tally.withEndpoint} callable=${tally.callable}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\n  REMOTE RESOLUTION DONE — ${processed.toLocaleString()} in ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
console.log(`  resolved ok           ${tally.ok.toLocaleString()}`);
console.log(`  failed                ${tally.fail.toLocaleString()}`);
console.log(`  declare an endpoint   ${tally.withEndpoint.toLocaleString()}`);
console.log(`  callable + clean      ${tally.callable.toLocaleString()}`);
console.log(`  fatal URL defect      ${tally.fatal.toLocaleString()}`);
console.log(`  written: ${OUT}\n`);
