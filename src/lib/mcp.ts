/**
 * GEBO's MCP server core: a dependency-free JSON-RPC 2.0 dispatcher for the
 * MCP Streamable HTTP transport (protocol revision 2025-06-18).
 *
 * Why hand-rolled rather than @modelcontextprotocol/sdk: the transport for
 * read-only tools is two shapes of POST (request -> response, notification ->
 * 202) plus 405s for GET/DELETE, and keeping it dependency-free means no new
 * install surface, no bundle weight on Vercel, and nothing to go stale. The
 * protocol layer lives here, pure and unit-testable; the tool implementations
 * that touch the database are injected by app/mcp/route.ts.
 *
 * "WebMCP ready" today means three things, all shipped together:
 *   1. this server, at https://gebo-bsc.vercel.app/mcp, usable by any MCP
 *      client (Claude, Cursor, VS Code) right now;
 *   2. discovery via /.well-known/mcp(.json) and /llms.txt;
 *   3. tool definitions that map one-to-one onto Chrome's WebMCP declarative
 *      forms when that API ships stable - the browser-native part is still
 *      behind a flag/origin trial, so building against it now would be
 *      building against a moving target.
 *
 * Design law L2 follows the tools out the door: every response carries its
 * window and caveats, because a bare number from an MCP tool is the same
 * defect as a bare number on a page.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

export const MCP_SERVER_INFO = {
  name: "gebo",
  version: "1.0.0",
  title: "GEBO - BNB Smart Chain agent registry",
} as const;

export const MCP_INSTRUCTIONS =
  "GEBO is a verification-first registry for agents on BNB Smart Chain. " +
  "Every figure it returns is a measurement: counts are census reads, liveness is " +
  "an on-schedule probe from one region (it cannot distinguish 'agent is down' from " +
  "'unreachable from here'), and track records are graded by an independent evaluator, " +
  "never by GEBO. There are no popularity rankings and no star ratings by design. " +
  "URLs in results point at human-readable pages with full qualifiers.";

export type JsonRpcId = string | number | null;

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

export type JsonRpcError = { code: number; message: string; data?: unknown };

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
};

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export type McpToolImpl = (args: Record<string, unknown>) => Promise<McpToolResult>;

/** Tool metadata. Implementations are injected by the route. */
export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "search_agents",
    description:
      "Search registered BNB Chain agents by capability (e.g. 'rebalance liquidity', 'watch my loan', " +
      "'x402 payments'). Results are ordered by trust state first and relevance second, never by " +
      "popularity. Each hit says why it matched and carries a registry URL with full qualifiers.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text capability query" },
        limit: { type: "number", description: "Max hits (default 10, capped at 40)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_agent",
    description:
      "Full registry card for one agent by its ERC-8004 token id: trust state with reason, endpoint, " +
      "liveness measurements, category, track-record summary, and hire URL. Says 'found: false' rather " +
      "than an error when the token id is not in the registry.",
    inputSchema: {
      type: "object",
      properties: {
        token_id: { type: "number", description: "ERC-8004 token id" },
      },
      required: ["token_id"],
    },
  },
  {
    name: "list_categories",
    description:
      "The job categories GEBO audits agents into: four judged categories (fixed by the BNB rubric) " +
      "and the adjacent categories detected from verified capability text.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_opportunities",
    description:
      "Live on-chain work indexed from BNB Smart Chain (PancakeSwap V3 positions, Venus markets): " +
      "what an agent could act on right now. Each row links to a detail page with the full chain " +
      "state it was read at. Reads age; treat them as of the read block.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "One of: rebalancing, grid, yield, health. Omit for all.",
        },
        limit: { type: "number", description: "Max rows (default 15, capped at 50)" },
      },
    },
  },
  {
    name: "get_registry_stats",
    description:
      "Registry census: agents indexed, distinct owners, endpoint operators, share held by the top " +
      "operators, and how many agents answer a live protocol handshake. Carries read-window qualifiers " +
      "and the single-region probing caveat.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_track_record",
    description:
      "Attestation ledger summary for one agent: runs recorded, succeeded, independently verified " +
      "evidence, distinct attesters. Track records are graded by an independent evaluator contract; " +
      "GEBO never grades agents it lists.",
    inputSchema: {
      type: "object",
      properties: {
        token_id: { type: "number", description: "ERC-8004 token id" },
      },
      required: ["token_id"],
    },
  },
];

const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;

function response(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function isNotification(msg: JsonRpcMessage): boolean {
  return msg.id === undefined || msg.id === null;
}

function toolResultToText(result: McpToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

/**
 * Dispatch one JSON-RPC message. Returns a JsonRpcResponse, or null for
 * notifications (which the HTTP layer answers with 202 and no body).
 * Tool implementations are injected so this stays DB-free and testable.
 */
export async function handleJsonRpc(
  msg: JsonRpcMessage,
  tools: Record<string, McpToolImpl>,
): Promise<JsonRpcResponse | null> {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg) || typeof msg.method !== "string") {
    return errorResponse(null, ERR_INVALID_REQUEST, "Invalid JSON-RPC request");
  }

  // Notifications get no response body, per both JSON-RPC 2.0 and MCP.
  // "notifications/initialized" is the only one a stateless server cares
  // about, and all it means here is "acknowledged".
  const id: JsonRpcId = msg.id ?? null;
  if (msg.id === undefined || msg.id === null) return null;

  const { method, params } = msg;

  if (method === "initialize") {
    const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
    const protocolVersion =
      requested && SUPPORTED_VERSIONS.has(requested) ? requested : MCP_PROTOCOL_VERSION;
    return response(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER_INFO,
      instructions: MCP_INSTRUCTIONS,
    });
  }

  if (method === "ping") {
    return response(id, {});
  }

  if (method === "tools/list") {
    return response(id, { tools: MCP_TOOLS });
  }

  if (method === "tools/call") {
    const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const impl = typeof p.name === "string" ? tools[p.name] : undefined;
    if (!impl) {
      return errorResponse(id, ERR_INVALID_PARAMS, `Unknown tool: ${String(p.name)}`);
    }
    let result: McpToolResult;
    try {
      result = await impl((p.arguments ?? {}) as Record<string, unknown>);
    } catch (err) {
      // A thrown tool is a tool failure the client can show, not a protocol
      // failure - and the message must not pretend nothing happened.
      return response(id, {
        content: [{ type: "text", text: `Tool execution failed: ${String((err as Error).message)}` }],
        isError: true,
      });
    }
    return response(id, result);
  }

  if (method === "resources/list" || method === "prompts/list") {
    // Explicitly empty rather than method-not-found: some clients probe these
    // on connect and -32601 reads as a broken server.
    return response(id, method === "resources/list" ? { resources: [] } : { prompts: [] });
  }

  return errorResponse(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
}

/** HTTP-level handling: parse, dispatch (single or batch), serialise. */
export async function handleMcpPost(
  body: unknown,
  tools: Record<string, McpToolImpl>,
): Promise<{ status: number; body: JsonRpcResponse | JsonRpcResponse[] | null }> {
  let parsed: unknown = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { status: 400, body: errorResponse(null, ERR_PARSE, "Parse error") };
    }
  }

  const messages: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  // Batching was deprecated in protocol revision 2025-06-18, but accepting it
  // costs nothing and keeps older clients working.
  const responses: JsonRpcResponse[] = [];
  for (const m of messages) {
    const r = await handleJsonRpc(m as JsonRpcMessage, tools);
    if (r) responses.push(r);
  }
  if (responses.length === 0) {
    // All notifications (or an empty batch): 202 with no body, per the spec.
    return { status: 202, body: null };
  }
  return { status: 200, body: Array.isArray(parsed) && responses.length > 1 ? responses : responses[0]! };
}

export { toolResultToText };
