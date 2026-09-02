"use client";

/**
 * Browser-native WebMCP (Chrome agent-mode) tool registration.
 *
 * This is the in-page half of the agent frontdoor: the /mcp endpoint serves
 * remote MCP clients, and this registers a navigation-and-read SUBSET of that
 * capability set with document.modelContext so a browser-resident agent
 * landing on GEBO can act on the page it is looking at, with the human
 * watching. Reads proxy to this origin's own /mcp server, so the two surfaces
 * can never disagree about what the data says.
 *
 * Philosophy carried over from the hire pages: an agent may NAVIGATE a user
 * to a decision (search results, an agent card, the hire flow) and may READ
 * registry data, but it never signs anything. The wallet steps stay human.
 *
 * Feature-detected and inert everywhere the API does not exist (today: every
 * browser without the WebMCP flag or origin trial), so this is pure
 * progressive enhancement - no error, no overhead, no behaviour change.
 */
import { useEffect } from "react";

type ModelContextTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown;
};

type ModelContextLike = {
  registerTool?: (tool: ModelContextTool) => Promise<void>;
};

/** Call a tool on this origin's own MCP server (POST /mcp, JSON-RPC). */
async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const json = (await res.json()) as {
    result?: { content?: { type: string; text?: string }[]; isError?: boolean };
    error?: { message?: string };
  };
  if (json.error) return `MCP error: ${json.error.message ?? "unknown"}`;
  const text = json.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  return json.result?.isError ? text : text || JSON.stringify(json.result ?? {}, null, 2);
}

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

export default function WebMcpTools() {
  useEffect(() => {
    const mc = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
    if (!mc?.registerTool) return; // not a WebMCP browser: stay inert

    const register = (tool: ModelContextTool) =>
      mc.registerTool!(tool).catch(() => {
        /* NotAllowedError when the tools permission is disabled: the right
           response is silence, not a broken page. */
      });

    register({
      name: "search-agents",
      description:
        "Search GEBO's registry of BNB Smart Chain agents by capability and navigate this page " +
        "to the results, so the user and the agent see the same shortlist. Results are ordered " +
        "by trust state first, relevance second - never popularity.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What the agent should do, e.g. 'rebalance liquidity', 'watch my loan', 'x402 payments'" },
        },
        required: ["query"],
      },
      execute: ({ query }) => {
        const q = String(query ?? "").trim();
        if (!q) return textResult("query is required");
        window.location.href = `/search?q=${encodeURIComponent(q)}`;
        return textResult(`Navigating to search results for "${q}".`);
      },
    });

    register({
      name: "open-agent-card",
      description:
        "Navigate this page to an agent's registry card: trust state with reason, liveness " +
        "measurements, authority scope, and its attested track record. Use open-hire-flow " +
        "when the user wants to authorise the agent instead of reading about it.",
      inputSchema: {
        type: "object",
        properties: {
          token_id: { type: "number", description: "The agent's ERC-8004 token id, e.g. 259573" },
        },
        required: ["token_id"],
      },
      execute: ({ token_id }) => {
        const id = Number(token_id);
        if (!Number.isInteger(id) || id <= 0) return textResult("token_id must be a positive integer");
        window.location.href = `/a/${id}`;
        return textResult(`Navigating to agent #${id}.`);
      },
    });

    register({
      name: "open-hire-flow",
      description:
        "Navigate this page to the authorisation flow for an agent: scope presets, the live " +
        "blast-radius panel, a real chain-state simulation, then the on-chain hire steps. " +
        "The agent brings the user TO the signing UI; the wallet steps stay human - this tool " +
        "never signs, funds, or approves anything.",
      inputSchema: {
        type: "object",
        properties: {
          token_id: { type: "number", description: "The agent's ERC-8004 token id" },
        },
        required: ["token_id"],
      },
      execute: ({ token_id }) => {
        const id = Number(token_id);
        if (!Number.isInteger(id) || id <= 0) return textResult("token_id must be a positive integer");
        window.location.href = `/a/${id}/hire`;
        return textResult(`Navigating to the hire flow for agent #${id}. The user reviews scope and signs.`);
      },
    });

    register({
      name: "read-agent",
      description:
        "Read one agent's registry data without navigating: trust state and reason, endpoint, " +
        "liveness measurements with caveats, category, skills, and track-record summary.",
      inputSchema: {
        type: "object",
        properties: {
          token_id: { type: "number", description: "The agent's ERC-8004 token id" },
        },
        required: ["token_id"],
      },
      execute: async ({ token_id }) => {
        const id = Number(token_id);
        if (!Number.isInteger(id) || id <= 0) return textResult("token_id must be a positive integer");
        return textResult(await callMcpTool("get_agent", { token_id: id }));
      },
    });

    register({
      name: "get-registry-stats",
      description:
        "Registry census for BNB Smart Chain: agents indexed, distinct owners, endpoint " +
        "operators, top-operator share, and how many agents answer a live protocol handshake. " +
        "Carries read-window and single-region-probing caveats.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => textResult(await callMcpTool("get_registry_stats", {})),
    });

    register({
      name: "get-verified-reviews",
      description:
        "Read one agent's verified reviews: free-text comments from wallets that completed " +
        "an APEX escrow job as its client, each anchored to an on-chain job id. Evidence, " +
        "not scores - no ratings exist in GEBO by design, and reviews never affect ordering. " +
        "An empty result means no completed hire exists yet, not that the agent is bad.",
      inputSchema: {
        type: "object",
        properties: {
          token_id: { type: "number", description: "The agent's ERC-8004 token id" },
        },
        required: ["token_id"],
      },
      execute: async ({ token_id }) => {
        const id = Number(token_id);
        if (!Number.isInteger(id) || id <= 0) return textResult("token_id must be a positive integer");
        return textResult(await callMcpTool("get_verified_reviews", { token_id: id }));
      },
    });
  }, []);

  return null;
}
