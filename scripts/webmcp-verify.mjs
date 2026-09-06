/**
 * Runtime verification of the browser WebMCP surface against a live page,
 * over raw CDP. The static tests pin the source; this script exercises the
 * actual registration in a real flagged Chrome - the "failed never ships"
 * step, and the same ground truth the webmcp.com scanner collects.
 *
 * Prerequisite: Chrome running with the WebMCP testing flag and remote
 * debugging, e.g.
 *   chrome --remote-debugging-port=9222 --user-data-dir=<temp> \
 *          --no-first-run --enable-features=WebMCPTesting
 *          --enable-blink-features=WebMCP <url>
 *
 * Measures:
 *   1. document.modelContext present (flag took) - or says it cannot measure.
 *   2. getTools() after reload: names, schema properties, required fields.
 *   3. Console warnings during registration (a swallowed failure is how the
 *      surface once shrank to one visible tool).
 *   4. A data tool executed through the real path (POST /mcp, tools/call)
 *      returns structured data with a result count.
 *   5. The page URL is unchanged afterwards - answer tools never navigate.
 *
 * Usage: node scripts/webmcp-verify.mjs [port] [url-substring]
 * Exits non-zero when a measured check fails; prints what it measured.
 */

const port = process.argv[2] ?? "9222";
const match = process.argv[3] ?? "gebo-bsc";
const debug = `http://127.0.0.1:${port}`;

async function waitFor(ws, messageId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP message ${messageId} timed out`)), timeoutMs);
    const handler = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id === messageId) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
  });
}

function evalOn(ws, expression) {
  const id = Math.floor(Math.random() * 1e9);
  const p = waitFor(ws, id, 20000);
  ws.send(JSON.stringify({
    id, method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
  return p;
}

async function main() {
  // 0. Find the target tab.
  let tabs;
  try {
    tabs = await (await fetch(`${debug}/json/list`)).json();
  } catch {
    console.error(`CANNOT MEASURE: no CDP endpoint at ${debug}. Start Chrome with --remote-debugging-port=${port} and the WebMCP flag.`);
    process.exit(2);
  }
  const tab = tabs.find((t) => t.type === "page" && t.url.includes(match));
  if (!tab) {
    console.error(`CANNOT MEASURE: no open tab matching "${match}". Open ${match} in the debugged Chrome first.`);
    console.error(`Open tabs: ${tabs.map((t) => t.url).join(", ")}`);
    process.exit(2);
  }
  console.log(`Tab: ${tab.url}`);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("page websocket failed"));
  });

  // 1. Flag check.
  const hasMc = await evalOn(ws, "typeof document.modelContext");
  if (hasMc.result?.value !== "object") {
    console.error("CANNOT MEASURE: document.modelContext is not an object - the WebMCP flag did not take in this Chrome. Relaunch with the testing flag (about:flags#enable-webmcp-testing or --enable-features=WebMCPTesting --enable-blink-features=WebMCP).");
    process.exit(2);
  }
  console.log("document.modelContext: present (flag took)");

  // 2. Reload and collect console output during registration.
  const consoleLines = [];
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.method === "Runtime.consoleAPICalled") {
      consoleLines.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    }
  });
  await evalOn(ws, "Runtime.enable").then(() => {});
  ws.send(JSON.stringify({ id: 900001, method: "Page.reload", params: { ignoreCache: true } }));
  await new Promise((r) => setTimeout(r, 6000)); // hydration + registration

  const toolsResult = await evalOn(ws, `(async () => {
    const tools = await document.modelContext.getTools();
    return JSON.stringify(tools.map((t) => ({
      name: t.name,
      hasDescription: typeof t.description === "string" && t.description.length > 40,
      inputType: t.inputSchema?.type,
      properties: Object.keys(t.inputSchema?.properties ?? {}),
      required: t.inputSchema?.required ?? [],
      hasAnnotations: !!t.annotations,
      readOnly: t.annotations?.readOnlyHint,
    })));
  })()`);
  const tools = JSON.parse(toolsResult.result?.value ?? "[]");
  console.log(`\ngetTools(): ${tools.length} tool(s) registered`);
  for (const t of tools) {
    console.log(
      `  ${t.name.padEnd(22)} props=[${t.properties.join(",")}] required=[${t.required.join(",")}]` +
      ` readOnly=${t.readOnly}${t.hasDescription ? "" : "  (description missing!)"}`,
    );
  }
  const webmcpWarnings = consoleLines.filter((l) => l.includes("[webmcp]"));
  if (webmcpWarnings.length) {
    console.error(`\nREGISTRATION FAILURES (${webmcpWarnings.length}):`);
    for (const w of webmcpWarnings) console.error(`  ${w}`);
  } else {
    console.log("\nRegistration warnings: none");
  }

  // 3. Execute a data tool through the real path (POST /mcp, tools/call).
  const searchResult = await evalOn(ws, `(async () => {
    const res = await fetch("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "search_agents", arguments: { query: "rebalance liquidity", limit: 5 } } }),
    });
    const json = await res.json();
    const payload = json.result?.structuredContent ?? JSON.parse(json.result?.content?.[0]?.text ?? "{}");
    return JSON.stringify({
      isError: json.result?.isError ?? json.error !== undefined,
      result_count: payload.result_count,
      first_name: payload.results?.[0]?.name ?? null,
      ordering: payload.ordering?.slice(0, 40) ?? null,
    });
  })()`);
  console.log(`\nsearch_agents via POST /mcp: ${searchResult.result?.value}`);
  const sr = JSON.parse(searchResult.result?.value ?? "{}");
  const searchOk = !sr.isError && typeof sr.result_count === "number";

  // 4. Answer tools never navigate: URL must be unchanged.
  const url = await evalOn(ws, "window.location.pathname");
  console.log(`\nURL after data-tool execution: ${url.result?.value} (unchanged = pass)`);

  // Verdict.
  const expected = [
    "search_agents", "get_agent", "list_categories", "get_opportunities",
    "get_registry_stats", "get_track_record", "get_verified_reviews",
    "open_agent_card", "open_hire_flow",
  ];
  const names = tools.map((t) => t.name).sort();
  const expectedSorted = [...expected].sort();
  const coverageOk = JSON.stringify(names) === JSON.stringify(expectedSorted);
  const noNav = url.result?.value === tab.url.replace(/^https?:\/\/[^/]+/, "") || url.result?.value === "/";
  const noFailures = webmcpWarnings.length === 0;

  console.log("\nVerdict:");
  console.log(`  coverage (9 tools):     ${coverageOk ? "PASS" : "FAIL - got " + names.join(", ")}`);
  console.log(`  registration failures:  ${noFailures ? "PASS" : "FAIL"}`);
  console.log(`  data tool returns data: ${searchOk ? "PASS" : "FAIL"}`);
  console.log(`  no navigation on read:  ${noNav ? "PASS" : "FAIL"}`);

  process.exit(coverageOk && noFailures && searchOk && noNav ? 0 : 1);
}

main().catch((e) => {
  console.error(`CANNOT MEASURE: ${e.message}`);
  process.exit(2);
});
