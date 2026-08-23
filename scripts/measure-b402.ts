/**
 * Measure the B402 Bazaar catalogue.
 *
 * Binance publishes a total. This paginates the whole catalogue and reports what
 * that total is made of, because a count is not coverage: the interesting question
 * is how many independent parties are behind it and whether any of them publish
 * usage data.
 *
 * Read-only, no auth, no key. Anyone can repeat it, which is the point.
 *
 * Run: npx tsx scripts/measure-b402.ts
 */
import { fetchB402Catalogue, analyseCatalogue, baseUnitsToTokens } from "../src/lib/b402.ts";

const started = Date.now();

try {
  const { items, reportedTotal, pages, truncated } = await fetchB402Catalogue();
  const a = analyseCatalogue(items, reportedTotal);
  const pct = (n: number) => `${n.toFixed(1)}%`;

  console.log(`\n  B402 BAZAAR  (public, unauthenticated)`);
  console.log(`    reported total            ${a.reportedTotal.toLocaleString()}`);
  console.log(`    retrieved and de-duped    ${a.observed.toLocaleString()}  across ${pages} page(s)`);
  if (truncated) {
    console.log(`    INCOMPLETE: retrieved fewer than the reported total`);
  }

  console.log(`\n  WHO IS BEHIND THE CATALOGUE`);
  console.log(`    payment options           ${a.acceptsTotal.toLocaleString()}  across ${a.observed.toLocaleString()} listings`);
  console.log(`    distinct payees           ${a.distinctPayees.toLocaleString()}`);
  console.log(`    distinct hostnames        ${a.distinctHosts.toLocaleString()}`);
  if (a.topPayee) {
    console.log(`    largest payee             ${a.topPayee}`);
    console.log(`                              ${a.topPayeeCount.toLocaleString()} of ${a.acceptsTotal.toLocaleString()} payment options  (${pct(a.topPayeeSharePct)})`);
  }

  console.log(`\n  USAGE DATA  (Binance documents a quality block on each record)`);
  console.log(`    records carrying it       ${a.withQuality.toLocaleString()} of ${a.observed.toLocaleString()}`);
  if (a.withQuality === 0) {
    console.log(`    l30DaysTotalCalls, l30DaysUniquePayers and lastCalledAt are`);
    console.log(`    specified in the docs and absent from every live record, so`);
    console.log(`    nothing in this catalogue says whether an endpoint is used.`);
  }

  console.log(`\n  PRICING`);
  if (a.priceMin != null && a.priceMax != null) {
    console.log(`    range                     ${a.priceMin} - ${a.priceMax} tokens per call`);
    console.log(`    (18 decimals on BSC; reading these as 6 is a 10^12 error)`);
  } else {
    console.log(`    no priced listing found`);
  }

  console.log(`\n  NETWORKS`);
  for (const n of a.networks.slice(0, 5)) {
    console.log(`    ${n.network.padEnd(24)} ${n.n.toLocaleString()}  (${pct((n.n / a.acceptsTotal) * 100)})`);
  }
  console.log(`\n  ASSETS`);
  for (const s of a.assets.slice(0, 5)) {
    console.log(`    ${s.asset.padEnd(44)} ${s.n.toLocaleString()}`);
  }
  console.log(`\n  SCHEMES`);
  for (const s of a.schemes.slice(0, 5)) {
    console.log(`    ${s.scheme.padEnd(24)} ${s.n.toLocaleString()}`);
  }

  // A concrete example, so the concentration is legible rather than abstract.
  const topHosts = new Map<string, number>();
  for (const it of items) {
    const payTo = (it.accepts?.[0]?.payTo ?? "").toLowerCase();
    if (payTo !== a.topPayee) continue;
    try { const h = new URL(it.resource).hostname; topHosts.set(h, (topHosts.get(h) ?? 0) + 1); } catch {}
  }
  const ranked = [...topHosts.entries()].sort((x, y) => y[1] - x[1]);
  if (ranked.length) {
    console.log(`\n  HOSTS BEHIND THE LARGEST PAYEE  (${ranked.length} distinct)`);
    for (const [h, n] of ranked.slice(0, 8)) console.log(`    ${String(n).padStart(4)}  ${h}`);
  }

  console.log(`\n  measured in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
} catch (e: any) {
  console.error(`\n  FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s: ${String(e?.message ?? e)}\n`);
  process.exitCode = 1;
}
