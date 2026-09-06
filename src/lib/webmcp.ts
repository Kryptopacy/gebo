/**
 * The browser WebMCP surface, declared once and derived from MCP_TOOLS.
 *
 * Why derivation instead of duplication: three surfaces serve agents here
 * (the MCP server at /mcp, the assistant, and this browser surface), and
 * three hand-maintained lists have already drifted once - the webmcp.com
 * scan found one tool where six were registered. Every data tool below
 * reuses the MCP server's name, description, input schema and output
 * contract, so the browser surface cannot disagree with the server surface.
 *
 * Contract rules this module encodes:
 *
 *  1. Answer tools never navigate. Chrome classifies "answer" tools as
 *     read-only, and webmcp.com scores that way too; the old search tool
 *     assigned itself window.location.href mid-execute, which both broke
 *     the read-only contract and destroyed the page context that hosted
 *     the other tool registrations mid-scan - one defect, four findings.
 *     Data returns; navigation is a separate, explicit tool.
 *  2. Every tool executes by POSTing to this origin's own /mcp endpoint,
 *     so the browser surface and the MCP server surface are literally the
 *     same reads - they cannot diverge because there are not two of them.
 *  3. Navigation tools (open_agent_card, open_hire_flow) are the only
 *     tools that touch window.location, and they say so in their names,
 *     descriptions and annotations. They correspond to page-visible state
 *     changes only - nothing that moves money or authority is exposed as
 *     a tool, per the agent-surface law.
 *
 * The imperative API has no outputSchema member (it is open issue #9 in the
 * WebMCP spec), so each answer tool's description ends with a compact
 * "Returns:" line - the output contract travels in the description, where
 * every consumer reads it, including the webmcp.com classifier.
 */

import {
  MCP_TOOLS, SEARCH_CATEGORIES, OPPORTUNITY_CATEGORIES,
  type McpToolDef, type McpOutputSchema,
} from "./mcp";

// Re-exported so tests and llms.txt generators can treat this module as the
// single declaration site for the browser surface's accepted enums.
export { SEARCH_CATEGORIES, OPPORTUNITY_CATEGORIES };

export type WebMcpAnnotation = {
  readOnlyHint: boolean;
  /** Only navigation tools set this false, and they are page-visible moves only. */
  consequentialHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebMcpDataTool = McpToolDef & {
  /** "answer" tools per the directory's trust ladder: reads, no side effects. */
  kind: "answer";
  /** The MCP server tool this proxies to (same name). */
  mcpTool: string;
  annotations: WebMcpAnnotation;
};

export type WebMcpNavigationTool = {
  name: string;
  kind: "act";
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations: WebMcpAnnotation;
  /** Absolute path this tool navigates to. */
  url: (args: Record<string, unknown>) => string;
};

/**
 * The "Returns:" line every data-tool description carries. Chrome's
 * registerTool accepts an outputSchema member but silently DROPS it
 * (probed 2026-09-06: getTools() returns only name/description/
 * inputSchema/annotations), so the description is the one channel the
 * output contract can travel in - and the webmcp.com scanner docks
 * "no output schema" for its absence. outputSchema.required is a
 * non-empty tuple by type, so the key list is never empty.
 */
function returnsLine(desc: string, outputSchema: McpOutputSchema): string {
  const keys = Object.keys(outputSchema.properties);
  return (
    desc +
    " Returns a JSON object with keys: " +
    keys.join(", ") +
    " - caveats included, a bare number is never a measurement."
  );
}

/**
 * Data tools: one per MCP read tool, schema-identical. The four criticism
 * findings from the webmcp.com scan each map to a rule here: coverage (this
 * list is the full MCP read set), schemas (inherited, with constraints),
 * naming (snake_case), and output contracts ("Returns:" lines).
 */
const DATA_TOOLS: WebMcpDataTool[] = MCP_TOOLS.map((t) => ({
  ...t,
  kind: "answer" as const,
  mcpTool: t.name,
  description: returnsLine(t.description, t.outputSchema),
  annotations: { readOnlyHint: true },
}));

const NAV_CARD_URL = "/a/{token_id}";
const NAV_HIRE_URL = "/a/{token_id}/hire";

export const WEBMCP_NAV_TOOLS: WebMcpNavigationTool[] = [
  {
    name: "open_agent_card",
    kind: "act",
    description:
      "Navigate this browser to an agent's card page, where a human sees the full registry " +
      "record: trust state and reason, liveness, category, track record and verified reviews. " +
      "Use when the user says 'show me', 'open', 'take me to' an agent. This moves the page; " +
      "to read an agent's data without moving the page, call get_agent instead.",
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
    },
    annotations: { readOnlyHint: false, consequentialHint: false },
    url: (args) => `/a/${String(args.token_id ?? "").replace(/[^0-9]/g, "x") || "0"}`,
  },
  {
    name: "open_hire_flow",
    kind: "act",
    description:
      "Navigate this browser to the human-visible hire flow for an agent: scope picker, " +
      "spend caps, blast-radius disclosure, then the APEX escrow. Money and authority moves " +
      "only on this page, never through a tool. Use when the user says 'hire this agent'. " +
      "This moves the page; it does not and cannot sign, fund or commit anything itself.",
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
    },
    annotations: { readOnlyHint: false, consequentialHint: false },
    url: (args) => `/a/${String(args.token_id ?? "").replace(/[^0-9]/g, "x") || "0"}/hire`,
  },
];

/** Full imperative surface: every MCP read tool plus the two navigation tools. */
export const WEBMCP_TOOLS: (WebMcpDataTool | WebMcpNavigationTool)[] = [
  ...DATA_TOOLS,
  ...WEBMCP_NAV_TOOLS,
];

/** Ordered tool names, for llms.txt and tests. */
export const WEBMCP_TOOL_NAMES: string[] = WEBMCP_TOOLS.map((t) => t.name);

/** The MCP tools the browser surface proxies (in MCP_TOOLS order). */
export const WEBMCP_DATA_TOOL_NAMES: string[] = DATA_TOOLS.map((t) => t.mcpTool);

export { NAV_CARD_URL, NAV_HIRE_URL };
