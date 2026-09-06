/**
 * GEBO's browser WebMCP bootstrap: registers the imperative tool surface at
 * HTML parse time via inline <script>.
 *
 * WHY PARSE TIME, NOT REACT (this is the scanner's actual blind spot):
 * the webmcp.com scanner snapshots tools shortly after load. React
 * hydration on a fresh visit completes seconds later, so a useEffect-based
 * registrar is invisible to that snapshot: three scans in a row scored
 * only the two declarative form tools and reported "thin two-page
 * coverage" while nine imperative tools were code-shipped. Registering
 * from an inline script in <head> means the tools exist before any
 * framework runs - same registration, visible to any snapshotter.
 *
 * WHY DERIVED FROM ONE SOURCE:
 * the tool specs live in src/lib/webmcp.ts (built from MCP_TOOLS). This
 * module serializes them to JSON for the inline script; the script only
 * wires execute to fetch("/mcp"). One spec site means the browser surface
 * cannot drift from the MCP server surface, and tests pin the invariant.
 *
 * Chrome-surface facts this design encodes (probed on 2026-09-06):
 *  - registerTool accepts outputSchema but silently DROPS it: the output
 *    contract must travel in the description as a "Returns:" line;
 *  - getTools() strips execute, so what the scanner scores is the
 *    registration surface (name/description/inputSchema/annotations);
 *  - removeTool(name) exists, so the React component can hand over
 *    cleanly if it ever needs to re-register;
 *  - duplicate names throw InvalidStateError, so declarative form tools
 *    must never share a name with an imperative tool.
 */

import {
  WEBMCP_TOOLS, type WebMcpNavigationTool,
} from "./webmcp";

/**
 * Serialize the tool specs for the inline bootstrap. Descriptions for data
 * tools already carry their "Returns:" lines from the spec builder; this
 * only shapes what execute needs: name + kind + (for navigation) URL path.
 */
export function webmcpBootstrapScript(): string {
  const tools = WEBMCP_TOOLS.map((t) => ({
    name: t.name,
    kind: t.kind,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
    description: t.description,
    // Navigation tools: URL template, since the inline script cannot import
    // the url() functions. Data tools: the MCP server tool to proxy to.
    ...(t.kind === "act"
      ? { urlTemplate: t.name === "open_hire_flow" ? "/a/{token_id}/hire" : "/a/{token_id}" }
      : { mcpTool: t.mcpTool }),
  }));

  return `(function(){
  if (typeof document.modelContext === "undefined" || !document.modelContext.registerTool) return;
  var TOOLS = ${JSON.stringify(tools)};
  function mcpCall(name, args) {
    return fetch("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: name, arguments: args } }),
    }).then(function (res) { return res.json(); }).then(function (json) {
      if (json.error) return "MCP error: " + (json.error.message || "unknown");
      var text = (json.result && json.result.content || []).map(function (c) { return c.text || ""; }).join("\\n");
      return (json.result && json.result.isError) ? text : (text || JSON.stringify(json.result || {}, null, 2));
    }).catch(function () {
      return "MCP call failed - the data layer could not be reached. Unmeasured, not zero.";
    });
  }
  var route = {
    answer: function (t) {
      return function (args) { return mcpCall(t.mcpTool, args || {}); };
    },
    act: function (t) {
      return function (args) {
        var id = String((args || {}).token_id || "").replace(/[^0-9]/g, "");
        if (!id) return "token_id must be digits, e.g. 259573";
        var url = t.urlTemplate.replace("{token_id}", id);
        window.location.href = url;
        return "Navigating this page to " + url + ". The user now sees what you see. Nothing was signed, funded or approved - the wallet steps stay human.";
      };
    },
  };
  for (var i = 0; i < TOOLS.length; i++) {
    var t = TOOLS[i];
    try {
      document.modelContext.registerTool({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
        execute: route[t.kind](t),
      }).catch(function (e) {
        console.warn("[webmcp-bootstrap] registerTool failed:", e);
      });
    } catch (e) {
      console.warn("[webmcp-bootstrap] registerTool threw:", e);
      return;
    }
  }
})();`;
}

export type { WebMcpNavigationTool };
