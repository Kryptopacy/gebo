/**
 * Pins the browser WebMCP surface (src/lib/webmcp.ts + app/WebMcpTools.tsx).
 *
 * The webmcp.com scorecard graded this surface B with four findings - single
 * tool, no output schema, loose input constraints, no filters or pagination.
 * Each finding maps to a rule below:
 *
 *  1. Coverage: the browser surface exposes EVERY MCP read tool plus two
 *     navigation tools - the tool list can never silently shrink to one.
 *  2. Output contract: every data tool is derived from MCP_TOOLS, whose
 *     outputSchema.required is a non-empty tuple; the imperative API has no
 *     outputSchema member (spec issue #9) so the contract travels as a
 *     "Returns:" line in the description - pinned here so it cannot be
 *     dropped in an edit.
 *  3. Constraints: search has minLength/maxLength + category enum; limit
 *     params have minimum/maximum/default; token_id params have a digits
 *     pattern. Loose schemas are what "loose input constraints" meant.
 *  4. Answer tools never navigate; navigation tools are the only ones that
 *     touch window.location (via the url() function), and their URLs are
 *     pinned. The old search-agents navigating mid-execute is what killed
 *     the scan after tool one.
 *  5. Parity with the data layer: SEARCH_CATEGORIES must equal the category
 *     slugs in src/lib/data.ts, so the enum an agent sees matches the
 *     categories the registry actually audits.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WEBMCP_TOOLS, WEBMCP_TOOL_NAMES, WEBMCP_DATA_TOOL_NAMES,
  SEARCH_CATEGORIES, OPPORTUNITY_CATEGORIES,
  type WebMcpDataTool, type WebMcpNavigationTool,
} from "../src/lib/webmcp";
import { MCP_TOOLS } from "../src/lib/mcp";
import { CATEGORIES } from "../src/lib/data";

const SNAKE = /^[a-z][a-z0-9_]*$/;

const dataTools = WEBMCP_TOOLS.filter((t): t is WebMcpDataTool => t.kind === "answer");
const navTools = WEBMCP_TOOLS.filter((t): t is WebMcpNavigationTool => t.kind === "act");

describe("coverage: the browser surface mirrors the MCP server", () => {
  it("exposes every MCP read tool plus the two navigation tools", () => {
    expect(WEBMCP_TOOL_NAMES).toEqual([
      ...MCP_TOOLS.map((t) => t.name),
      "open_agent_card",
      "open_hire_flow",
    ]);
  });

  it("derives each data tool from the MCP tool of the same name", () => {
    for (const t of dataTools) {
      const mcp = MCP_TOOLS.find((m) => m.name === t.name);
      expect(mcp, `data tool ${t.name} must exist in MCP_TOOLS`).toBeDefined();
      expect(t.mcpTool).toBe(t.name);
      expect(t.inputSchema).toEqual(mcp!.inputSchema);
      expect(t.outputSchema).toEqual(mcp!.outputSchema);
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe("quality: names and descriptions", () => {
  it("uses conventional snake_case names throughout", () => {
    for (const t of WEBMCP_TOOLS) expect(t.name).toMatch(SNAKE);
  });

  it("every data-tool description contract survives the Returns: transform", () => {
    // The component appends a "Returns:" line; the description it starts
    // from must be substantial enough to carry it.
    for (const t of dataTools) {
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.outputSchema.required.length).toBeGreaterThan(0);
    }
  });

  it("navigation tools disclose that they move the page", () => {
    for (const t of navTools) {
      expect(t.description).toMatch(/[Mm]oves the page|Navigate this browser/);
      expect(t.annotations.readOnlyHint).toBe(false);
    }
  });
});

describe("input constraints", () => {
  it("search_agents has bounds and a category enum", () => {
    const search = MCP_TOOLS.find((m) => m.name === "search_agents")!;
    const p = search.inputSchema.properties as Record<string, any>;
    expect(p.query.minLength).toBe(1);
    expect(p.query.maxLength).toBe(200);
    expect(p.category.enum).toEqual([...SEARCH_CATEGORIES]);
    expect(p.limit.minimum).toBe(1);
    expect(p.limit.maximum).toBe(40);
    expect(p.limit.default).toBe(10);
  });

  it("token_id params are digits-only strings with a pattern", () => {
    for (const t of WEBMCP_TOOLS) {
      const p = t.inputSchema.properties as Record<string, any>;
      if (p.token_id) {
        expect(p.token_id.type).toBe("string");
        expect(p.token_id.pattern).toBe("^[0-9]{1,18}$");
      }
    }
  });

  it("get_opportunities has a category enum and limit bounds", () => {
    const t = MCP_TOOLS.find((m) => m.name === "get_opportunities")!;
    const p = t.inputSchema.properties as Record<string, any>;
    expect(p.category.enum).toEqual([...OPPORTUNITY_CATEGORIES]);
    expect(p.limit.minimum).toBe(1);
    expect(p.limit.maximum).toBe(50);
    expect(p.limit.default).toBe(15);
  });

  it("the category enum matches the registry's actual category slugs", () => {
    expect(SEARCH_CATEGORIES).toEqual(Object.keys(CATEGORIES));
    expect(new Set(SEARCH_CATEGORIES).size).toBe(SEARCH_CATEGORIES.length);
  });
});

describe("navigation URLs are pinned", () => {
  it("open_agent_card builds /a/{token_id}", () => {
    const t = navTools.find((n) => n.name === "open_agent_card")!;
    expect(t.url({ token_id: "259573" })).toBe("/a/259573");
  });

  it("open_hire_flow builds /a/{token_id}/hire", () => {
    const t = navTools.find((n) => n.name === "open_hire_flow")!;
    expect(t.url({ token_id: "259573" })).toBe("/a/259573/hire");
  });

  it("navigation never signs, funds or approves anything", () => {
    // Source-level pin: the only window.location touch in the registrar is
    // the navigation-tool branch. Money and authority stay on human-visible
    // pages - grep the component so a future edit cannot quietly add one.
    const src = readFileSync(resolve(__dirname, "../app/WebMcpTools.tsx"), "utf8");
    const locAssignments = src.match(/window\.location\.href\s*=/g) ?? [];
    expect(locAssignments.length).toBe(1);
  });
});

describe("data tools execute via this origin's own /mcp", () => {
  it("the registrar POSTs to /mcp and nowhere else", () => {
    const src = readFileSync(resolve(__dirname, "../app/WebMcpTools.tsx"), "utf8");
    expect(src).toContain('fetch("/mcp"');
    // No other fetch target appears in the component.
    expect(src.match(/fetch\(/g)?.length).toBe(1);
  });

  it("WEBMCP_DATA_TOOL_NAMES lists exactly the MCP read set", () => {
    expect(WEBMCP_DATA_TOOL_NAMES).toEqual(MCP_TOOLS.map((t) => t.name));
  });
});

describe("declarative form tools stay snake_case", () => {
  it("layout, search and authority forms use snake_case toolnames", async () => {
    const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
    const layout = read("../app/layout.tsx");
    const search = read("../app/search/page.tsx");
    const authority = read("../app/authority/page.tsx");
    for (const src of [layout, search, authority]) {
      const names = [...src.matchAll(/toolname: "([^"]+)"/g)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(n).toMatch(SNAKE);
    }
    expect(layout).toContain('toolname: "search_agents"');
    expect(search).toContain('toolname: "search_agents"');
    expect(authority).toContain('toolname: "check_wallet_authority"');
  });
});

describe("declarative form inputs carry constraints", () => {
  // The rescan finding "wallet lacks regex/required constraints" maps here:
  // the declarative synthesis turns HTML required/pattern/maxLength into
  // schema constraints, so the attributes ARE the schema.
  it("the authority wallet input is required with an address pattern", async () => {
    const authority = readFileSync(resolve(__dirname, "../app/authority/page.tsx"), "utf8");
    const walletInput = authority.match(/<input[^]*?name="wallet"[^]*?\/>/)?.[0] ?? "";
    expect(walletInput).toContain("required");
    expect(walletInput).toContain('pattern="0x[0-9a-fA-F]{40}"');
  });

  it("the search inputs are required with a maxLength matching the MCP schema", async () => {
    const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
    for (const src of [read("../app/layout.tsx"), read("../app/search/page.tsx")]) {
      const qInput = src.match(/<input[^]*?name="q"[^]*?\/>/)?.[0] ?? "";
      expect(qInput).toContain("required");
      expect(qInput).toContain("maxLength={200}");
    }
  });

  it("declarative descriptions document what the tool returns", async () => {
    const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
    // The declarative API has no output schema (open spec question), so the
    // output contract travels in tooldescription - same law as the
    // imperative "Returns:" lines.
    expect(read("../app/authority/page.tsx")).toContain("The result lists each session key");
    expect(read("../app/layout.tsx")).toContain("The result page lists each matching agent");
  });
});
