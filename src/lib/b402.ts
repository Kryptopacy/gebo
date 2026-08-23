/**
 * B402 Bazaar: Binance's public catalogue of paid agent endpoints on BSC.
 *
 * WHY THIS IS THE ONLY BINANCE SURFACE WORTH CODING AGAINST.
 *
 * Binance's agent stack has no on-chain agent registry, no directory, no
 * reputation intake and no capability taxonomy - grep the whole developer docs
 * index for 8004, 8183, registry, reputation or attest and there are zero hits.
 * Agent OS is exchange-side plumbing (MCP, CEX APIs, an OAuth sub-account), and
 * the Agentic Wallet keeps its authority state off chain by design. There is
 * nothing there to verify.
 *
 * The Bazaar is different: public, unauthenticated, and it lists real HTTP
 * endpoints with real prices and real payees. It is a claim about a working
 * economy, which makes it measurable - and this project's entire argument is that
 * claims should be measured rather than repeated.
 *
 * WHAT THE MEASUREMENT FOUND, AND WHY IT MATTERS.
 *
 * The catalogue reports a total. Rendering that total as coverage is the mistake
 * every competitor will make, because it is the one number the API hands you.
 * Paginating the whole thing says something different: the listings collapse onto
 * a handful of payees, and the `quality` block that Binance's own documentation
 * specifies - l30DaysTotalCalls, l30DaysUniquePayers, lastCalledAt - is absent
 * from every live record. So the field that would let anyone judge whether these
 * endpoints are actually used does not arrive.
 *
 * That is not a criticism worth making rhetorically. It is a denominator: N
 * listings from M distinct payees, of which zero carry usage data. Published with
 * its own limits stated, that is evidence.
 *
 * DECIMALS. maxAmountRequired is a base-unit integer against an 18-decimal BSC
 * stablecoin, not 6 as on other chains. A slip here is a 10^12 pricing error, so
 * the conversion lives in one place and is tested.
 */

/** Where the catalogue lives. Documented as public, read-only, no auth. */
const BASE = "https://www.binance.com/bapi/ramp/v1/public/ramp/b402";

/** The API caps a page at 100 regardless of what is asked for. */
const MAX_PAGE = 100;

export type B402Accept = {
  scheme: string;
  network: string;
  asset: string;
  maxAmountRequired: string;
  payTo: string;
};

/**
 * The quality block Binance documents but does not send.
 *
 * Typed as fully optional because it has never been observed on a live record.
 * Keeping the shape means the day it appears, ingestion records it rather than
 * silently discarding a field nobody remembered to map.
 */
export type B402Quality = {
  l30DaysTotalCalls?: number;
  l30DaysUniquePayers?: number;
  lastCalledAt?: number;
};

export type B402Resource = {
  resource: string;
  type: string;
  x402Version: number;
  description: string | null;
  accepts: B402Accept[];
  quality?: B402Quality | null;
  lastUpdated: number | null;
};

export type B402Page = {
  items: B402Resource[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * Fetch one page.
 *
 * Returns the reported total alongside the items so a caller can paginate without
 * assuming the count it was told first is still true - the catalogue changes
 * under pagination, and a fixed loop bound would silently truncate or overrun.
 */
export async function fetchB402Page(
  offset: number,
  limit = MAX_PAGE,
  signal?: AbortSignal,
): Promise<B402Page> {
  const capped = Math.min(Math.max(1, limit), MAX_PAGE);
  const url = `${BASE}/bazaar/resources?limit=${capped}&offset=${offset}`;

  const res = await fetch(url, {
    signal,
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`b402 ${res.status} at offset ${offset}`);

  const body = (await res.json()) as {
    success?: boolean;
    code?: string;
    data?: {
      items?: B402Resource[];
      pagination?: { limit: number; offset: number; total: number };
    };
  };

  // Binance wraps errors in a 200 with success:false, so status alone is not proof.
  if (body.success === false) throw new Error(`b402 returned success=false (code ${body.code})`);

  const items = body.data?.items ?? [];
  const p = body.data?.pagination;
  return {
    items,
    total: p?.total ?? items.length,
    limit: p?.limit ?? capped,
    offset: p?.offset ?? offset,
  };
}

/**
 * Walk the whole catalogue.
 *
 * Bounded by a hard page cap as well as by the reported total: a total that grows
 * while paginating would otherwise loop indefinitely, and an endpoint that ignores
 * offset would return page one forever. Stops on a page that adds nothing new.
 */
export async function fetchB402Catalogue(
  opts: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<{ items: B402Resource[]; reportedTotal: number; pages: number; truncated: boolean }> {
  const maxPages = opts.maxPages ?? 40;
  const seen = new Set<string>();
  const items: B402Resource[] = [];
  let reportedTotal = 0;
  let pages = 0;

  for (let offset = 0; pages < maxPages; offset += MAX_PAGE) {
    const page = await fetchB402Page(offset, MAX_PAGE, opts.signal);
    pages++;
    reportedTotal = page.total;

    let added = 0;
    for (const it of page.items) {
      // Identity is (payTo, resource) per the docs, so the same URL served by two
      // payees is two listings and must not be collapsed.
      const key = `${(it.accepts?.[0]?.payTo ?? "").toLowerCase()}|${it.resource}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
      added++;
    }

    if (!page.items.length || added === 0) break;
    if (items.length >= reportedTotal) break;
  }

  return { items, reportedTotal, pages, truncated: items.length < reportedTotal };
}

export type CatalogueAnalysis = {
  /** What the API says it has. */
  reportedTotal: number;
  /** What we actually retrieved and de-duplicated. */
  observed: number;
  /**
   * Total accepts entries across all listings, and the correct denominator for
   * network, asset and scheme shares.
   *
   * A listing may offer several payment options, so these counts exceed the
   * listing count - 986 accepts across 976 listings when first measured, which
   * printed "eip155:56  101.0%". Dividing a per-accept count by a per-listing
   * total is precisely the denominator mismatch design law L2 exists to stop, and
   * it appeared in our own reporting of someone else's data.
   */
  acceptsTotal: number;
  /** Distinct payee addresses across the catalogue, lowercased. */
  distinctPayees: number;
  /** The largest payee and its share, which is the finding. */
  topPayee: string | null;
  topPayeeCount: number;
  topPayeeSharePct: number;
  /** How many records carry the documented quality block. */
  withQuality: number;
  /** Distinct hostnames. A payee can front many hosts, and often does. */
  distinctHosts: number;
  networks: { network: string; n: number }[];
  assets: { asset: string; n: number }[];
  schemes: { scheme: string; n: number }[];
  /** Price spread in whole tokens, for the qualifier. */
  priceMin: number | null;
  priceMax: number | null;
};

/** 18 decimals on BSC, not 6. A slip here is a 10^12 error. */
export function baseUnitsToTokens(raw: string, decimals = 18): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const d = BigInt(10) ** BigInt(decimals);
  const v = BigInt(raw);
  const whole = v / d;
  const frac = v % d;
  return Number(whole) + Number(frac) / Number(d);
}

/**
 * Turn a retrieved catalogue into the numbers a reader can act on.
 *
 * Pure, so the claims made on the page are testable without a network call. Every
 * field carries its own denominator: a share is meaningless without the count it
 * was taken from, which is design law L2 applied to someone else's data.
 */
export function analyseCatalogue(
  items: B402Resource[],
  reportedTotal: number,
): CatalogueAnalysis {
  const payees = new Map<string, number>();
  const hosts = new Set<string>();
  const networks = new Map<string, number>();
  const assets = new Map<string, number>();
  const schemes = new Map<string, number>();
  let withQuality = 0;
  let priceMin: number | null = null;
  let priceMax: number | null = null;
  let acceptsTotal = 0;

  for (const it of items) {
    // A record with no accepts entry prices nothing and cannot be paid, so it is
    // counted in the total but contributes no payee or asset.
    for (const a of it.accepts ?? []) {
      acceptsTotal++;
      const payTo = (a.payTo ?? "").toLowerCase();
      if (payTo) payees.set(payTo, (payees.get(payTo) ?? 0) + 1);
      if (a.network) networks.set(a.network, (networks.get(a.network) ?? 0) + 1);
      if (a.asset) assets.set(a.asset.toLowerCase(), (assets.get(a.asset.toLowerCase()) ?? 0) + 1);
      if (a.scheme) schemes.set(a.scheme, (schemes.get(a.scheme) ?? 0) + 1);

      const tokens = a.maxAmountRequired ? baseUnitsToTokens(a.maxAmountRequired) : null;
      if (tokens != null) {
        priceMin = priceMin == null ? tokens : Math.min(priceMin, tokens);
        priceMax = priceMax == null ? tokens : Math.max(priceMax, tokens);
      }
    }

    try {
      hosts.add(new URL(it.resource).hostname.toLowerCase());
    } catch {
      // A listing whose resource is not a URL cannot be called. Not counted as a
      // host rather than guessed at.
    }

    const q = it.quality;
    if (q && (q.l30DaysTotalCalls != null || q.l30DaysUniquePayers != null || q.lastCalledAt != null)) {
      withQuality++;
    }
  }

  const ranked = [...payees.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0] ?? null;
  const observed = items.length;

  return {
    reportedTotal,
    observed,
    acceptsTotal,
    distinctPayees: payees.size,
    topPayee: top ? top[0] : null,
    topPayeeCount: top ? top[1] : 0,
    /**
     * Share of ACCEPTS, not of listings, matching how payees are counted above.
     * A listing with two accepts entries naming one payee contributes twice.
     */
    topPayeeSharePct: top && acceptsTotal > 0 ? (top[1] / acceptsTotal) * 100 : 0,
    withQuality,
    distinctHosts: hosts.size,
    networks: [...networks.entries()].map(([network, n]) => ({ network, n })).sort((a, b) => b.n - a.n),
    assets: [...assets.entries()].map(([asset, n]) => ({ asset, n })).sort((a, b) => b.n - a.n),
    schemes: [...schemes.entries()].map(([scheme, n]) => ({ scheme, n })).sort((a, b) => b.n - a.n),
    priceMin,
    priceMax,
  };
}
