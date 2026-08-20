/**
 * 8004scan API client.
 *
 * Contract verified against the live OpenAPI spec + live responses on
 * 2026-08-18. Two things the published spec gets wrong, both handled here:
 *
 *  1. The list and detail endpoints return DIFFERENT shapes. List gives ~30
 *     fields; detail gives ~70, and only detail carries the endpoint URLs
 *     (mcp_server / a2a_endpoint / agent_url / services) and the health fields.
 *  2. Feedback scores are 0-100, not the 0-5 the spec documents.
 *
 * Rate limits are respected from response headers rather than assumed.
 * X-RateLimit-Reset is an ISO-8601 timestamp, not a seconds offset.
 */
import "dotenv/config";

const BASE = process.env.EIGHT004SCAN_BASE_URL ?? "https://8004scan.io/api/v1/public";
const KEY = process.env.EIGHT004SCAN_API_KEY;

/** Pro tier is 500/min. Stay under it so a burst never trips a 429. */
const MAX_PER_MIN = Number(process.env.SCAN_MAX_PER_MIN ?? 400);
const MIN_INTERVAL_MS = Math.ceil(60_000 / MAX_PER_MIN);

export type ScanMeta = {
  version: string;
  timestamp: string;
  requestId: string;
  pagination?: { page: number; limit: number; total: number; hasMore: boolean };
};

export type AgentListItem = {
  id: string;
  agent_id: string;
  token_id: string;
  chain_id: number;
  contract_address: string;
  owner_address: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  is_verified: boolean;
  star_count: number;
  supported_protocols: string[] | null;
  x402_supported: boolean;
  total_score: number;
  rank: number | null;
  health_score: number | null;
  total_feedbacks: number;
  average_score: number;
  created_at: string;
  updated_at: string;
};

/** Detail response — superset of the list item. Only fields we rely on are typed. */
export type AgentDetail = AgentListItem & {
  agent_type: string | null;
  agent_wallet: string | null;
  tags: string[] | null;
  categories: string[] | null;
  services: unknown;
  is_active: boolean | null;
  supported_trust_models: string[] | null;

  // endpoints — the reason detail exists for us
  mcp_server: string | null;
  mcp_version: string | null;
  a2a_endpoint: string | null;
  a2a_version: string | null;
  agent_url: string | null;
  ens: string | null;
  did: string | null;

  // 8004scan's own endpoint verification + health (snapshot, not longitudinal)
  is_endpoint_verified: boolean | null;
  endpoint_verified_at: string | null;
  endpoint_verified_domain: string | null;
  endpoint_verification_error: string | null;
  endpoint_last_checked_at: string | null;
  health_status: string | null;
  health_checked_at: string | null;

  // their score decomposition
  quality_score: number | null;
  popularity_score: number | null;
  activity_score: number | null;
  wallet_score: number | null;
  freshness_score: number | null;
  metadata_completeness_score: number | null;

  parse_status: string | null;
  total_validations: number | null;
  successful_validations: number | null;
};

let lastRequestAt = 0;
let observedRemaining: number | null = null;
let observedResetAt: number | null = null;

export const stats = { requests: 0, retries: 0, rateLimitWaits: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  // Hard floor between requests.
  const since = Date.now() - lastRequestAt;
  if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);

  // If the server says we're nearly out, wait for the window to roll.
  if (observedRemaining !== null && observedRemaining <= 2 && observedResetAt) {
    const wait = observedResetAt - Date.now();
    if (wait > 0) {
      stats.rateLimitWaits++;
      await sleep(Math.min(wait + 500, 65_000));
    }
  }
  lastRequestAt = Date.now();
}

function readRateHeaders(res: Response) {
  const rem = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (rem !== null) observedRemaining = Number(rem);
  // ISO-8601 timestamp, not a seconds offset.
  if (reset) {
    const t = Date.parse(reset);
    observedResetAt = Number.isNaN(t) ? null : t;
  }
}

export async function scan<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  attempt = 0,
): Promise<{ data: T; meta: ScanMeta }> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  await throttle();
  stats.requests++;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(KEY ? { "X-API-Key": KEY } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (attempt < 4) {
      stats.retries++;
      await sleep(1000 * 2 ** attempt + Math.random() * 400);
      return scan<T>(path, params, attempt + 1);
    }
    throw err;
  }

  readRateHeaders(res);

  if (res.status === 429 || res.status >= 500) {
    if (attempt < 5) {
      stats.retries++;
      const wait =
        res.status === 429 && observedResetAt
          ? Math.min(Math.max(observedResetAt - Date.now(), 1000), 65_000)
          : 1000 * 2 ** attempt + Math.random() * 400;
      await sleep(wait);
      return scan<T>(path, params, attempt + 1);
    }
  }

  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok || body?.success === false) {
    throw new Error(
      `8004scan ${res.status} ${path} :: ${JSON.stringify(body?.error ?? body).slice(0, 240)}`,
    );
  }
  return { data: body.data as T, meta: body.meta as ScanMeta };
}

/** Total matching a filter, without pulling the rows. */
export async function countAgents(params: Record<string, string | number | boolean | undefined>) {
  const { meta } = await scan<AgentListItem[]>("/agents", { ...params, limit: 1, page: 1 });
  return meta.pagination?.total ?? 0;
}

/** Page through /agents. limit is capped at 100 by the API. */
export async function* iterateAgents(
  params: Record<string, string | number | boolean | undefined>,
  opts: { pageSize?: number; maxPages?: number } = {},
): AsyncGenerator<AgentListItem[]> {
  const limit = Math.min(opts.pageSize ?? 100, 100);
  let page = 1;
  while (true) {
    const { data, meta } = await scan<AgentListItem[]>("/agents", { ...params, limit, page });
    if (!data?.length) return;
    yield data;
    if (!meta.pagination?.hasMore) return;
    if (opts.maxPages && page >= opts.maxPages) return;
    page++;
  }
}

export async function getAgentDetail(chainId: number, tokenId: string | number) {
  const { data } = await scan<AgentDetail>(`/agents/${chainId}/${tokenId}`);
  return data;
}

export async function getStats() {
  const { data } = await scan<any>("/stats");
  return data;
}
