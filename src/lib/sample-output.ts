/**
 * Live sample output for agent cards.
 *
 * Calls the agent's A2A endpoint with a category-specific sample query and
 * returns the result. This is the "try before you authorize" preview — users
 * see what the agent would actually return before they commit to hiring.
 *
 * Fails silently: a slow or broken endpoint shows "unavailable" rather than
 * blanking the card. The agent may be perfectly good; the sample is just a
 * convenience.
 */
import { classify, CATEGORIES, type CategorySlug } from "./data";
import type { Agent } from "./data";

const SAMPLE_QUERIES: Partial<Record<CategorySlug, string>> = {
  health:
    "What is the Venus lending health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055 on BNB Chain? Report the ratio and whether the position is at risk of liquidation.",
  rebalancing:
    "What is the current state of the CAKE/USDT 0.05% PancakeSwap V3 pool? Report the current tick, liquidity, and whether the position needs re-ranging.",
  grid:
    "What is the current state of the WBNB/USDT 0.05% PancakeSwap V3 pool? Report the current tick and whether grid orders should be placed.",
  yield:
    "Across the major Venus markets (vBNB, vUSDT, vUSDC, vBTC, vETH), which market currently pays suppliers the highest APR, and what is that APR in percent?",
};

export type SampleOutput = {
  query: string;
  response: string | null;
  latencyMs: number | null;
  error: string | null;
};

export async function fetchSampleOutput(agent: Agent): Promise<SampleOutput | null> {
  const m = classify(agent);
  const slug = m.category as CategorySlug | null;
  if (!slug || !SAMPLE_QUERIES[slug]) return null;

  const a2aEndpoint = agent.endpoints.find((e) => e.kind === "a2a");
  if (!a2aEndpoint) return null;

  const query = SAMPLE_QUERIES[slug]!;
  const started = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(a2aEndpoint.url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            messageId: `gebo-preview-${Date.now()}`,
            parts: [{ kind: "text", text: query }],
          },
        },
      }),
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - started;
    const raw = await res.text();

    // Parse JSON-RPC response
    try {
      const parsed = JSON.parse(raw);
      const result = parsed?.result;
      if (!result) {
        return { query, response: null, latencyMs, error: "no result in response" };
      }

      // Extract text from A2A message parts
      const parts = result?.message?.parts ?? result?.parts ?? [];
      const textParts = parts
        .filter((p: any) => p.kind === "text" && p.text)
        .map((p: any) => p.text);
      const response = textParts.join("\n").slice(0, 800) || null;

      return { query, response, latencyMs, error: null };
    } catch {
      return { query, response: null, latencyMs, error: "non-JSON response" };
    }
  } catch (e: any) {
    const latencyMs = Date.now() - started;
    const aborted = e?.name === "AbortError";
    return {
      query,
      response: null,
      latencyMs,
      error: aborted ? "timed out" : String(e?.message ?? e).slice(0, 100),
    };
  }
}
