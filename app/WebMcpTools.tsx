"use client";

/**
 * Browser-native WebMCP (Chrome agent-mode) tool registration.
 *
 * This is the in-page half of the agent frontdoor: the /mcp endpoint serves
 * remote MCP clients, and this registers the SAME tool set (plus two
 * explicit navigation tools) with document.modelContext so a
 * browser-resident agent landing on GEBO can act on the page it is looking
 * at, with the human watching. Reads proxy to this origin's own /mcp
 * server, so the browser surface and the MCP surface are literally the
 * same reads - there are not two of them to disagree.
 *
 * The registrations live in src/lib/webmcp.ts, derived from MCP_TOOLS, so
 * this component is a thin registrar: names, descriptions, schemas and
 * output contracts are pinned in one place and pinned by
 * tests/webmcp.test.ts.
 *
 * Contract rules, learned from the webmcp.com B grade:
 *  - answer tools never navigate (the old search-agents set
 *    window.location.href mid-execute, which broke the read-only contract
 *    AND destroyed the page context hosting the other registrations
 *    mid-scan - one defect, four findings: single tool, no output schema,
 *    loose constraints, no pagination);
 *  - every tool description ends with a "Returns:" line because the
 *    imperative API has no outputSchema member (spec issue #9) - the
 *    output contract travels in the description;
 *  - all registrations fire in parallel and failures are logged, so the
 *    complete set reaches the browser registry as early as possible and
 *    a failing registration is diagnosable instead of silently missing;
 *  - the wallet steps stay human: nothing that signs, funds or approves
 *    is a tool, and the hire navigation tool says so.
 *
 * Feature-detected and inert everywhere the API does not exist (today:
 * every browser without the WebMCP flag or origin trial), so this is pure
 * progressive enhancement - no error, no overhead, no behaviour change.
 */
import { useEffect } from "react";
import { WEBMCP_TOOLS, type WebMcpNavigationTool } from "@/lib/webmcp";

type ModelContextTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
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

// Chrome's imperative API documents execute() returning a plain string (see
// developer.chrome.com/docs/ai/webmcp/imperative-api); the MCP content
// envelope is server shape, not browser shape.

/**
 * The "Returns:" line every tool description carries. The imperative API
 * has no outputSchema (spec issue #9), so the output contract travels in
 * the description, where every consumer reads it - including the
 * webmcp.com classifier that docked us for having none.
 */
function returnsLine(desc: string, outputProps: string[]): string {
  const shape = outputProps.length
    ? ` a JSON object with keys: ${outputProps.join(", ")}`
    : " a JSON object";
  return (
    desc +
    " Returns" +
    shape +
    ", caveats included - a bare number is never a measurement."
  );
}

export default function WebMcpTools() {
  useEffect(() => {
    const mc = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
    if (!mc?.registerTool) return; // not a WebMCP browser: stay inert

    const register = (tool: ModelContextTool) =>
      mc.registerTool!(tool).catch((err: unknown) => {
        /* NotAllowedError when the tools permission is disabled: the right
           response is silence, not a broken page. Any other failure is
           logged, because a registration the scanner silently misses is
           exactly how this surface once shrank to one visible tool. */
        console.warn(`[webmcp] registerTool(${tool.name}) failed:`, err);
      });

    // All registrations start immediately and run in parallel, so the full
    // set is in the browser's registry as early as possible - a scanner (or
    // a real agent) that snapshots getTools() right after load sees all of
    // them, not the subset a sequential loop had finished by then.
    const registerAll = async () => {
      await Promise.all(
        WEBMCP_TOOLS.map((tool) => {
          if (tool.kind === "answer") {
            const outProps = Object.keys(
              (tool.outputSchema.properties ?? {}) as Record<string, unknown>,
            );
            return register({
              name: tool.name,
              description: returnsLine(tool.description, outProps),
              inputSchema: tool.inputSchema,
              annotations: tool.annotations,
              execute: (args) => callMcpTool(tool.mcpTool, args),
            });
          }
          return register({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            execute: (args) => {
              const url = (tool as WebMcpNavigationTool).url(args);
              window.location.href = url;
              return (
                `Navigating this page to ${url}. The user now sees what you see. ` +
                "Nothing was signed, funded or approved - the wallet steps stay human."
              );
            },
          });
        }),
      );
    };

    void registerAll();
  }, []);

  return null;
}
