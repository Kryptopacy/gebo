/**
 * Pins the MCP server core (src/lib/mcp.ts):
 *
 * 1. initialize negotiates a supported protocol version and never echoes an
 *    unsupported one.
 * 2. Notifications get no response body (202 at the HTTP layer).
 * 3. tools/list exposes exactly the registry tools, each with a JSON Schema.
 * 4. tools/call: known tool runs; unknown tool is -32602; a thrown tool is an
 *    isError result the client can display, not a protocol error.
 * 5. resources/list and prompts/list answer empty arrays rather than
 *    method-not-found, because some clients probe them on connect.
 */
import { describe, expect, it } from "vitest";
import {
  handleJsonRpc, handleMcpPost, MCP_TOOLS, MCP_PROTOCOL_VERSION, MCP_SERVER_INFO,
  type McpToolImpl,
} from "../src/lib/mcp";

const okTool: McpToolImpl = async (args) => ({
  content: [{ type: "text", text: JSON.stringify({ echo: (args as { q?: string }).q ?? null }) }],
});
const throwTool: McpToolImpl = async () => {
  throw new Error("database unreachable");
};
const tools: Record<string, McpToolImpl> = { search_agents: okTool, boom: throwTool };

describe("initialize", () => {
  it("returns the requested version when supported", async () => {
    const r = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      tools,
    );
    expect(r!.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: MCP_SERVER_INFO });
  });

  it("falls back to the server version when the client asks for something unknown", async () => {
    const r = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      tools,
    );
    expect((r!.result as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it("carries instructions so clients surface the measurement caveats", async () => {
    const r = await handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, tools);
    expect((r!.result as { instructions: string }).instructions).toContain("one region");
  });
});

describe("notifications", () => {
  it("answers initialized with no response body", async () => {
    const r = await handleJsonRpc(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      tools,
    );
    expect(r).toBeNull();
  });

  it("turns an all-notification POST into 202 with no body", async () => {
    const { status, body } = await handleMcpPost(
      [{ jsonrpc: "2.0", method: "notifications/initialized" }],
      tools,
    );
    expect(status).toBe(202);
    expect(body).toBeNull();
  });
});

describe("tools", () => {
  it("lists the registry tools with schemas", () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual([
      "search_agents", "get_agent", "list_categories",
      "get_opportunities", "get_registry_stats", "get_track_record",
      "get_verified_reviews",
    ]);
    for (const t of MCP_TOOLS) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it("declares an output schema with non-empty required fields for every tool", () => {
    // An output schema without required fields validates anything; that is
    // documentation pretending to be a contract. The tuple type enforces
    // non-emptiness at compile time; this pins it against regression.
    for (const t of MCP_TOOLS) {
      expect(t.outputSchema.type).toBe("object");
      expect(t.outputSchema.required.length).toBeGreaterThan(0);
      // every required field must be declared in properties
      for (const field of t.outputSchema.required) {
        expect(t.outputSchema.properties[field]).toBeDefined();
      }
    }
  });

  it("passes structuredContent through tool calls untouched", async () => {
    // The route emits text and structuredContent from one payload; the
    // dispatcher must forward the structured half, not strip it.
    const r = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "echo_tool", arguments: {} },
      },
      {
        echo_tool: async () => ({
          content: [{ type: "text", text: "ok" }],
          structuredContent: { ok: true },
        }),
      },
    );
    expect(r!.result).toEqual({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { ok: true },
    });
  });

  it("dispatches a call and returns the tool text", async () => {
    const r = await handleJsonRpc(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "search_agents", arguments: { q: "grid" } } },
      tools,
    );
    const result = r!.result as { content: { text: string }[] };
    expect(JSON.parse(result.content[0]!.text)).toEqual({ echo: "grid" });
  });

  it("answers an unknown tool with invalid params, not method-not-found", async () => {
    const r = await handleJsonRpc(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nope" } },
      tools,
    );
    expect(r!.error!.code).toBe(-32602);
  });

  it("surfaces a thrown tool as an isError result the client can display", async () => {
    const r = await handleJsonRpc(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "boom" } },
      tools,
    );
    const result = r!.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Tool execution failed");
  });

  it("answers resources/list and prompts/list as empty rather than not-found", async () => {
    const res = await handleJsonRpc({ jsonrpc: "2.0", id: 10, method: "resources/list" }, tools);
    expect(res!.result).toEqual({ resources: [] });
    const pr = await handleJsonRpc({ jsonrpc: "2.0", id: 11, method: "prompts/list" }, tools);
    expect(pr!.result).toEqual({ prompts: [] });
  });
});

describe("protocol edge cases", () => {
  it("pings", async () => {
    const r = await handleJsonRpc({ jsonrpc: "2.0", id: 12, method: "ping" }, tools);
    expect(r!.result).toEqual({});
  });

  it("answers unknown methods with -32601", async () => {
    const r = await handleJsonRpc({ jsonrpc: "2.0", id: 13, method: "sampling/createMessage" }, tools);
    expect(r!.error!.code).toBe(-32601);
  });

  it("rejects a non-object message", async () => {
    const r = await handleJsonRpc("hello" as never, tools);
    expect(r!.error!.code).toBe(-32600);
  });

  it("returns a parse error for unparsable bodies", async () => {
    const { status, body } = await handleMcpPost("{not json", tools);
    expect(status).toBe(400);
    expect((body as { error: { code: number } }).error.code).toBe(-32700);
  });

  it("unwraps single responses and keeps batch shape for batches", async () => {
    const single = await handleMcpPost({ jsonrpc: "2.0", id: 1, method: "ping" }, tools);
    expect(!Array.isArray(single.body)).toBe(true);

    const batch = await handleMcpPost(
      [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ],
      tools,
    );
    expect(Array.isArray(batch.body)).toBe(true);
    expect((batch.body as unknown[]).length).toBe(2);
  });
});
