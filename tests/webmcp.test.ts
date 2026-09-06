/**
 * Pins the browser WebMCP surface (src/lib/webmcp.ts + the parse-time
 * bootstrap in src/lib/webmcp-bootstrap.ts).
 *
 * The webmcp.com scorecard graded this surface B with four findings - single
 * tool, no output schema, loose input constraints, no filters or pagination.
 * Each finding maps to a rule below:
 *
 *  1. Coverage: the browser surface exposes EVERY MCP read tool plus two
 *     navigation tools, registered at HTML parse time - the scanner's
 *     snapshot lands before React hydration, which is why three scans in
 *     a row scored only the two declarative form tools.
 *  2. Output contract: Chrome's registerTool ACCEPTS outputSchema but
 *     silently drops it (probed 2026-09-06), so the contract travels as a
 *     "Returns:" line in the description - pinned here so it cannot be
 *     dropped in an edit.
 *  3. Constraints: search has minLength/maxLength + category enum; limit
 *     params have minimum/maximum/default; token_id params have a digits
 *     pattern. Loose schemas are what "loose input constraints" meant.
 *  4. Answer tools never navigate; navigation tools are the only ones that
 *     touch window.location, and their URL templates are pinned.
 *  5. Parity with the data layer: SEARCH_CATEGORIES must equal the category
 *     slugs in src/lib/data.ts, so the enum an agent sees matches the
 *     categories the registry actually audits.
 *  6. No declarative form toolname may collide with an imperative tool
 *     name - Chrome throws InvalidStateError on duplicates, which silently
 *     downgraded the surface until the warning log caught it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  WEBMCP_TOOLS, WEBMCP_TOOL_NAMES, WEBMCP_DATA_TOOL_NAMES,
  SEARCH_CATEGORIES, OPPORTUNITY_CATEGORIES,
  type WebMcpDataTool, type WebMcpNavigationTool,
} from "../src/lib/webmcp";
import { webmcpBootstrapScript } from "../src/lib/webmcp-bootstrap";
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
    expect(WEBMCP_TOOL_NAMES).toContain("check_wallet_authority");
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

  it("check_wallet_authority carries the 0x wallet regex and chain enum", () => {
    const t = WEBMCP_TOOLS.find((m) => m.name === "check_wallet_authority");
    expect(t).toBeDefined();
    const p = t!.inputSchema.properties as Record<string, any>;
    expect(p.wallet.pattern).toBe("^0x[0-9a-fA-F]{40}$");
    expect(p.chain.enum).toEqual([56, 97]);
    expect(p.chain.default).toBe(56);
    expect(t!.inputSchema.required).toEqual(["wallet"]);
  });

  it("every tool inputSchema forbids undeclared properties", () => {
    // Kit convention (webmcp-kit): additionalProperties: false on every
    // input schema. Loose schemas were the "weak input constraints" finding.
    for (const t of WEBMCP_TOOLS) {
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
    for (const t of MCP_TOOLS) {
      expect(t.inputSchema.additionalProperties).toBe(false);
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
    // Source-level pin on the inline bootstrap: the only window.location
    // touch is the navigation-tool branch. Money and authority stay on
    // human-visible pages - grep the generated script so a future edit
    // cannot quietly add one.
    const src = webmcpBootstrapScript();
    const locAssignments = src.match(/window\.location\.href\s*=/g) ?? [];
    expect(locAssignments.length).toBe(1);
  });
});

describe("parse-time bootstrap", () => {
  // The scanner's snapshot lands before React hydration: three webmcp.com
  // scans scored only the declarative forms because the useEffect registrar
  // fired seconds later. The bootstrap must serialize every tool, guard on
  // modelContext presence, and log (not swallow) registration failures.
  it("serializes every tool with descriptions carrying Returns: lines", () => {
    const src = webmcpBootstrapScript();
    expect(src).toContain("var TOOLS = ");
    for (const t of WEBMCP_TOOLS) {
      expect(src).toContain(`"name":"${t.name}"`);
    }
    const dataTool = WEBMCP_TOOLS.find((t) => t.name === "search_agents");
    expect(dataTool?.description).toContain("Returns a JSON object with keys: query, result_count");
  });

  it("registers immediately, feature-detects, and warns on failure", () => {
    const src = webmcpBootstrapScript();
    // Runs at parse time: an async IIFE, not a deferred event handler.
    expect(src.trim().startsWith("(async function(){")).toBe(true);
    // Feature-detect before touching modelContext.
    expect(src).toContain('typeof document.modelContext === "undefined"');
    // Failures are logged, never swallowed silently.
    expect(src).toContain("[webmcp-bootstrap]");
  });

  it("registers sequentially and awaited, never as a fire-and-forget burst", () => {
    // The permission-race lesson from four webmcp.com scans: a burst of
    // registerTool calls registers exactly ONE tool (the first) in any
    // Chrome where the first call triggers the tools permission check,
    // because the rest fire while that check is pending. Sequential +
    // awaited + a per-call timeout is the only pattern that survives every
    // Chrome configuration.
    const src = webmcpBootstrapScript();
    expect(src).toContain("await Promise.race");
    expect(src).toContain("setTimeout(r, 4000)");
    // The loop must await each registration before starting the next.
    const loop = src.match(/for \(var i[\s\S]{0,2000}?TOOLS\.length; i\+\+\) \{[\s\S]*?\n  \}/);
    expect(loop?.[0]).toContain("await");
  });

  it("data tools execute by POSTing to this origin's own /mcp and nowhere else", () => {
    const src = webmcpBootstrapScript();
    expect(src).toContain('fetch("/mcp"');
    expect(src.match(/fetch\(/g)?.length).toBe(1);
  });

  it("WEBMCP_DATA_TOOL_NAMES lists exactly the MCP read set", () => {
    expect(WEBMCP_DATA_TOOL_NAMES).toEqual(MCP_TOOLS.map((t) => t.name));
  });
});

describe("the surface is all-imperative (no declarative form tools)", () => {
  // Chrome's declarative synthesis drops pattern/maxLength from the schema
  // it reports (the "wallet lacks 0x regex" finding persisted with the
  // pattern attribute present in the HTML), and a declarative twin of an
  // imperative tool either collides on the name (InvalidStateError) or
  // reads as overlapping intent to tool reviewers. Decision: zero
  // declarative tool attributes anywhere; forms stay human-only.
  it("no toolname/tooldescription/toolautosubmit/toolparamdescription in any app file", async () => {
    const pagesDir = resolve(__dirname, "../app");
    const sweep = (dir: string): string[] => {
      const found: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) found.push(...sweep(join(dir, e.name)));
        else if (/\.(tsx|ts)$/.test(e.name)) {
          const src = readFileSync(join(dir, e.name), "utf8");
          if (/tool(name|description|autosubmit|paramdescription)\s*:/.test(src)) {
            found.push(e.name);
          }
        }
      }
      return found;
    };
    expect(sweep(pagesDir)).toEqual([]);
  });
});

describe("forms keep native validation for humans", () => {
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
});
