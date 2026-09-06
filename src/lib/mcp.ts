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
 *   3. tool definitions that serialize one-to-one into the browser WebMCP
 *      bootstrap (src/lib/webmcp-bootstrap.ts) - the /mcp server and the
 *      in-page imperative surface are literally the same reads, derived
 *      from this list, so they cannot drift.
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

/**
 * Output schema for a tool result. `required` is a non-empty tuple BY TYPE -
 * [string, ...string[]] cannot be constructed empty - because an output
 * schema without required fields validates anything, and a schema that
 * validates anything is documentation pretending to be a contract.
 */
export type McpOutputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: [string, ...string[]];
};

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    /** Kit convention and agent-safety: no undeclared inputs. */
    additionalProperties?: false;
  };
  /** Declared for every tool: structured results are part of the contract. */
  outputSchema: McpOutputSchema;
};

export type McpToolResult = {
  content: { type: "text"; text: string }[];
  /** Structured payload conforming to the tool's outputSchema. */
  structuredContent?: unknown;
  isError?: boolean;
};

export type McpToolImpl = (args: Record<string, unknown>) => Promise<McpToolResult>;

/**
 * Category slugs the search tool accepts. Duplicated from the keys of
 * CATEGORIES in src/lib/data.ts rather than imported, so this module stays
 * free of the data layer (its whole point); tests/webmcp.test.ts pins the
 * two lists together so drift fails CI instead of shipping.
 */
export const SEARCH_CATEGORIES: string[] = [
  "rebalancing", "grid", "yield", "health",
  "trading", "research", "payments", "social", "infra",
];

/** Opportunities are indexed for the four judged categories only. */
export const OPPORTUNITY_CATEGORIES: string[] = ["rebalancing", "grid", "yield", "health"];

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
        query: {
          type: "string",
          description: "Free-text capability query",
          minLength: 1,
          maxLength: 200,
        },
        category: {
          type: "string",
          description:
            "Optional category filter. Judged: rebalancing, grid, yield, health. " +
            "Adjacent: trading, research, payments, social, infra. Omit for all.",
          enum: [...SEARCH_CATEGORIES],
        },
        limit: {
          type: "number",
          description: "Max hits (default 10, capped at 40)",
          minimum: 1,
          maximum: 40,
          default: 10,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        result_count: { type: "number" },
        ordering: { type: "string" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              token_id: { type: "string", description: "ERC-8004 token id" },
              name: { type: "string" },
              trust_state: { type: "string" },
              operator_domain: { type: ["string", "null"] },
              why_it_matched: { type: "string" },
              url: { type: "string" },
            },
            required: ["token_id", "name", "trust_state", "why_it_matched", "url"],
          },
        },
      },
      required: ["query", "result_count", "ordering", "results"],
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
        token_id: {
          type: "string",
          description: "ERC-8004 token id, digits only, e.g. 259573",
          pattern: "^[0-9]{1,18}$",
        },
      },
      required: ["token_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        found: { type: "boolean" },
        token_id: { type: "string", description: "ERC-8004 token id" },
        note: { type: "string", description: "present when found is false" },
        name: { type: "string" },
        url: { type: "string" },
        hire_url: { type: "string" },
        trust_state: { type: "string" },
        trust_reason: { type: "string" },
        category: { type: "string" },
        operator_domain: { type: ["string", "null"] },
        endpoints: { type: "array" },
        liveness: { type: ["object", "null"] },
        skills: { type: ["array", "null"] },
        self_description: { type: ["string", "null"] },
        track_record: { type: "object" },
      },
      required: ["found", "token_id"],
    },
  },
  {
    name: "list_categories",
    description:
      "The job categories GEBO audits agents into: four judged categories (fixed by the BNB rubric) " +
      "and the adjacent categories detected from verified capability text.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slug: { type: "string" },
              title: { type: "string" },
              job: { type: "string" },
              judged: { type: "boolean" },
              agents_audited: { type: "number" },
              url: { type: "string" },
            },
            required: ["slug", "title", "judged", "agents_audited", "url"],
          },
        },
        note: { type: "string" },
      },
      required: ["categories", "note"],
    },
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
          enum: [...OPPORTUNITY_CATEGORIES],
        },
        limit: {
          type: "number",
          description: "Max rows (default 15, capped at 50)",
          minimum: 1,
          maximum: 50,
          default: 15,
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        total_indexed: { type: "number" },
        returned: { type: "number" },
        category: { type: "string" },
        caveat: { type: "string" },
        opportunities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              category: { type: "string" },
              venue: { type: "string" },
              eligible: { type: "boolean" },
              ineligible_reason: { type: ["string", "null"] },
              url: { type: "string" },
            },
            required: ["id", "label", "category", "venue", "eligible", "url"],
          },
        },
      },
      required: ["total_indexed", "returned", "category", "caveat", "opportunities"],
    },
  },
  {
    name: "get_registry_stats",
    description:
      "Registry census: agents indexed, distinct owners, endpoint operators, share held by the top " +
      "operators, and how many agents answer a live protocol handshake. Carries read-window qualifiers " +
      "and the single-region probing caveat.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        tokens_minted: { type: "number" },
        censused: { type: "number" },
        agents_with_endpoint: { type: "number" },
        callable: { type: "number" },
        distinct_owners: { type: "number" },
        endpoint_operators: { type: "number" },
        top5_operator_share: { type: "string" },
        x402_supported: { type: "number" },
        live_read: { type: "boolean" },
        measured_at: { type: "string" },
        caveats: { type: "array", items: { type: "string" } },
      },
      required: [
        "tokens_minted", "censused", "agents_with_endpoint", "callable",
        "distinct_owners", "endpoint_operators", "top5_operator_share",
        "x402_supported", "live_read", "measured_at", "caveats",
      ],
    },
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
        token_id: {
          type: "string",
          description: "ERC-8004 token id, digits only, e.g. 259573",
          pattern: "^[0-9]{1,18}$",
        },
      },
      required: ["token_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        token_id: { type: "string", description: "ERC-8004 token id" },
        note: { type: "string", description: "present when the ledger could not be read" },
        attestations: { type: "number" },
        succeeded: { type: "number" },
        partial: { type: "number" },
        failed: { type: "number" },
        disputed: { type: "number" },
        verified_evidence: { type: "number" },
        distinct_attesters: { type: "number" },
        evidence_kinds: { type: "object", additionalProperties: { type: "number" } },
        caveat: { type: "string" },
        url: { type: "string" },
      },
      required: ["token_id"],
    },
  },
  {
    name: "get_verified_reviews",
    description:
      "Verified reviews for one agent: free-text comments from wallets that completed an APEX escrow " +
      "job as its client, each anchored to an on-chain job id verified at a specific block. Comments " +
      "are evidence, not scores - there are no star ratings or aggregates by design, and reviews " +
      "never affect ordering. Agents can POST their own review via the /api/reviews endpoint with " +
      "the same evidence gate.",
    inputSchema: {
      type: "object",
      properties: {
        token_id: {
          type: "string",
          description: "ERC-8004 token id, digits only, e.g. 259573",
          pattern: "^[0-9]{1,18}$",
        },
      },
      required: ["token_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        token_id: { type: "string", description: "ERC-8004 token id" },
        note: { type: "string" },
        count: { type: "number", description: "present when the read succeeded" },
        reviews: {
          type: "array",
          description: "present when count > 0",
          items: {
            type: "object",
            properties: {
              reviewer: { type: "string" },
              comment: { type: "string" },
              anchor: { type: "string" },
              created_at: { type: "string" },
            },
            required: ["reviewer", "comment", "anchor", "created_at"],
          },
        },
        url: { type: "string" },
      },
      required: ["token_id", "note"],
    },
  },
  {
    name: "check_wallet_authority",
    description:
      "Read which scoped session keys a BNB Chain wallet has registered in the Altana Keystore, and " +
      "whether each key is still valid on chain (revocation drops keys from the registry immediately, " +
      "expiry does not - so each key is checked individually). Use when the user asks what an agent " +
      "may do to a wallet, what sessions exist, or as authority context before a hire. This reads one " +
      "authority system: keystore-registered sessions only.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: {
          type: "string",
          description: "The BNB Chain address to check, e.g. 0x688Fe953e20225e0542ED11a11C708437e71d40e",
          pattern: "^0x[0-9a-fA-F]{40}$",
        },
        chain: {
          type: "number",
          description: "56 for BNB Smart Chain (default), 97 for BNB Testnet",
          enum: [56, 97],
          default: 56,
        },
      },
      required: ["wallet"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string" },
        chain: { type: "number" },
        /** Explicit when the keystore could not be read: never render as zero. */
        unavailable: { type: "string" },
        keys_registered_ever: { type: "number" },
        active_keys: { type: "number" },
        session_keys: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key_id: { type: "string" },
              valid: { type: "boolean", description: "live on-chain validity; false = expired or revoked" },
              key_id_matches_public_key: { type: "boolean" },
            },
            required: ["key_id", "valid", "key_id_matches_public_key"],
          },
        },
        block_number: { type: "string" },
        read_at: { type: "string" },
        /** Invariant 3 travels with the data: what this check cannot see. */
        not_covered: { type: "array", items: { type: "string" } },
      },
      required: ["wallet", "chain", "not_covered"],
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
