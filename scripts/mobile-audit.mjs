// Temporary mobile-layout audit: drives headless Chrome over CDP at a phone
// viewport, measures real horizontal overflow per route, flags the offending
// elements, and captures full-page screenshots for visual review.
// Usage: node scripts/tmp-mobile-audit.mjs [width] [height]
// Results: console table + JSON + JPEGs in %TEMP%\kilo\mobile-audit\

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_PORT = 9333;
const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3000";
const WIDTH = parseInt(process.argv[2] ?? "390", 10);
const HEIGHT = parseInt(process.argv[3] ?? "844", 10);
const OUT = join(tmpdir(), "kilo", "mobile-audit");

mkdirSync(OUT, { recursive: true });

function log(...a) {
  console.log(...a);
}

// Chrome launch is retried with a fresh profile directory and port each
// attempt: a killed previous run can leave a headless instance holding the
// profile lock, and Windows then fails the next launch silently.
/** Port of the successfully launched Chrome; auditRoute talks to this. */
let cdpPort = BASE_PORT;
function launchChrome() {
  const profile = join(tmpdir(), "kilo", `chrome-mobile-audit-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const port = BASE_PORT + launchChrome.attempts++;
  const args = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    "about:blank",
  ];
  const child = spawn(CHROME, args, { stdio: "ignore", detached: false });
  const bye = () => { try { child.kill(); } catch {} };
  process.on("exit", bye);
  process.on("SIGINT", () => { bye(); process.exit(1); });
  process.on("SIGTERM", () => { bye(); process.exit(1); });
  return { child, port };
}
launchChrome.attempts = 0;

async function waitForEndpoint(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return true;
    } catch {}
    await sleep(400);
  }
  return false;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const waiters = [];
    let nextId = 0;

    const api = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++nextId;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      waitEvent(method, timeoutMs = 90000) {
        return new Promise((res, rej) => {
          const t = setTimeout(
            () => rej(new Error("event timeout: " + method)),
            timeoutMs
          );
          waiters.push({ method, res, t });
        });
      },
      close() {
        try { ws.close(); } catch {}
      },
    };

    ws.onopen = () => resolve(api);
    ws.onerror = () => reject(new Error("websocket error"));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].method === msg.method) {
            const w = waiters[i];
            clearTimeout(w.t);
            waiters.splice(i, 1);
            w.res(msg.params);
          }
        }
      }
    };
  });
}

async function evalJs(conn, expression) {
  const r = await conn.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      "page eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 400)
    );
  }
  return r.result?.value;
}

const MEASURE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const mast = document.querySelector(".masthead .shell");
  const out = {
    path: location.pathname + location.search,
    viewport: vw,
    pageScrollWidth: de.scrollWidth,
    pageOverflow: de.scrollWidth > vw + 1,
    masthead: mast ? {
      scrolls: mast.scrollWidth > mast.clientWidth + 1,
      scrollWidth: mast.scrollWidth,
      clientWidth: mast.clientWidth,
    } : null,
    offenders: [],
    scrollContainers: [],
  };
  const seenContainers = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    const scrollsItself =
      (cs.overflowX === "auto" || cs.overflowX === "scroll") &&
      el.scrollWidth > el.clientWidth + 1;
    if (scrollsItself && !seenContainers.has(el)) {
      seenContainers.add(el);
      out.scrollContainers.push({
        cls: (el.className && el.className.toString().slice(0, 60)) || el.tagName,
        overflowPx: el.scrollWidth - el.clientWidth,
      });
    }
    if (el.closest(".masthead")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      out.offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.toString().slice(0, 70)) || "",
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
      if (out.offenders.length >= 15) break;
    }
  }
  out.links = {
    agents: Array.from(new Set(
      Array.from(document.querySelectorAll('a[href^="/a/"]'))
        .map((a) => a.getAttribute("href"))
    )).slice(0, 3),
    opportunities: Array.from(new Set(
      Array.from(document.querySelectorAll('a[href^="/o/"]'))
        .map((a) => a.getAttribute("href"))
    )).slice(0, 3),
  };
  return out;
})()`;

async function auditRoute(url, route, opts = {}) {
  const name = (opts.name ?? route)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "root";

  // Dev server compiles on demand and has exited mid-audit before; warm the
  // route over plain HTTP first so Chrome never races a cold compile.
  const warm = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!warm.ok) throw new Error(`warm fetch ${route} -> HTTP ${warm.status}`);

  const res = await fetch(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" }
  );
  const target = await res.json();
  const conn = await connect(target.webSocketDebuggerUrl);
  try {
    await conn.send("Page.enable");
    await conn.send("Runtime.enable");
    await conn.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: WIDTH,
      screenHeight: HEIGHT,
    });
    const loaded = conn.waitEvent("Page.loadEventFired", 90000).catch(() => null);
    await conn.send("Page.navigate", { url });
    await loaded;

    // Dev server compiles routes on demand; wait for the route-loading
    // marker to disappear, then let hydration and entrance animations settle.
    for (let i = 0; i < 100; i++) {
      const loading = await evalJs(conn, `!!document.querySelector('.route-loading')`);
      if (!loading) break;
      await sleep(500);
    }
    await sleep(2500);

    // Optional client-side interaction before measuring: click a tab button
    // by its visible text (tables inside inactive tabs never render, so the
    // static pass cannot see them), and/or force the light theme.
    if (opts.light) {
      await evalJs(
        conn,
        `document.documentElement.setAttribute('data-theme','light'), 'ok'`
      );
      await sleep(300);
    }
    if (opts.clickText) {
      const clicked = await evalJs(
        conn,
        `(() => {
          const btn = Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent.trim().startsWith(${JSON.stringify(opts.clickText)}));
          if (!btn) return "NOT FOUND";
          btn.click();
          return "ok";
        })()`
      );
      if (clicked !== "ok") throw new Error(`tab button not found: ${opts.clickText}`);
      await sleep(1500);
    }

    const metrics = await evalJs(conn, MEASURE);

    // A mismatch means Chrome rendered an error page (server dropped); retry.
    const expected = route.replace(/\?.*$/, "");
    if (metrics.path.replace(/\?.*$/, "") !== expected) {
      throw new Error(
        `landed on "${metrics.path}" instead of "${route}" (server dropped?)`
      );
    }

    // Very long pages make Chrome refuse captureBeyondViewport; clip, then
    // fall back to viewport-only.
    let shot;
    try {
      shot = await conn.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 55,
        captureBeyondViewport: true,
      });
    } catch {
      try {
        const layout = await evalJs(
          conn,
          "({h: document.documentElement.scrollHeight})"
        );
        shot = await conn.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 55,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: WIDTH, height: Math.min(layout.h, 8000), scale: 1 },
        });
      } catch {
        shot = await conn.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 55,
        });
      }
    }
    writeFileSync(join(OUT, `${WIDTH}-${name}.jpg`), Buffer.from(shot.data, "base64"));

    return metrics;
  } finally {
    conn.close();
    await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`).catch(() => {});
  }
}

async function main() {
  let chrome = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    chrome = launchChrome();
    log(`Chrome launching (attempt ${attempt}, port ${chrome.port}) ...`);
    if (await waitForEndpoint(chrome.port, 25000)) break;
    try { chrome.child.kill(); } catch {}
    chrome = null;
  }
  if (!chrome) throw new Error("Chrome CDP endpoint never came up after 3 attempts");
  cdpPort = chrome.port;
  try {
    log(`Chrome up on ${chrome.port}. Auditing ${BASE} at ${WIDTH}x${HEIGHT} ...`);

    const staticRoutes = [
      "/",
      "/categories",
      "/c/rebalancing",
      "/live",
      "/authority",
      "/compare",
      "/methodology",
      "/search?q=rebalancing",
    ];
    const results = [];
    const agentLinks = [];
    const oppLinks = [];

    for (const route of staticRoutes) {
      log(`- ${route}`);
      let m;
      for (let attempt = 1; ; attempt++) {
        try {
          m = await auditRoute(BASE + route, route);
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          log(`  retry ${attempt}: ${e.message}`);
          await sleep(3000);
        }
      }
      results.push(m);
      agentLinks.push(...(m.links?.agents ?? []));
      oppLinks.push(...(m.links?.opportunities ?? []));
    }

    const agent = agentLinks[0];
    if (agent) {
      for (const route of [agent, `${agent}/hire`]) {
        log(`- ${route}`);
        let m;
        for (let attempt = 1; ; attempt++) {
          try {
            m = await auditRoute(BASE + route, route);
            break;
          } catch (e) {
            if (attempt >= 3) throw e;
            log(`  retry ${attempt}: ${e.message}`);
            await sleep(3000);
          }
        }
        results.push(m);
      }
    } else {
      log("! no agent card link harvested; skipping /a routes");
    }

    // Tab-hidden tables: the static pass cannot render them, so click each
    // tab and measure what appears. These are the heaviest grids in the app
    // (the grid category's opportunity table carries seven fixed columns).
    const tabAgent = agentLinks[0];
    const tabTargets = [
      { route: "/c/grid", clickText: "Opportunities", tag: "c-grid-opps" },
      { route: "/methodology", clickText: "How categories evolve", tag: "method-terms" },
      { route: "/methodology", clickText: "How ranking works", tag: "method-ranking" },
      { route: "/methodology", clickText: "Venues", tag: "method-venues" },
    ];
    if (tabAgent) {
      tabTargets.push(
        { route: tabAgent, clickText: "Track record", tag: "agent-track" },
        { route: tabAgent, clickText: "Registration", tag: "agent-reg" },
        { route: tabAgent, clickText: "Authority", tag: "agent-auth-tab" },
      );
    } else {
      log("! no agent card link harvested; skipping agent-card tabs");
    }

    for (const t of tabTargets) {
      log(`- ${t.route} [click: ${t.clickText}]`);
      let m;
      for (let attempt = 1; ; attempt++) {
        try {
          m = await auditRoute(BASE + t.route, t.route, {
            clickText: t.clickText,
            name: t.tag,
          });
          m.path = `${t.route} (${t.clickText})`;
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          log(`  retry ${attempt}: ${e.message}`);
          await sleep(3000);
        }
      }
      results.push(m);
      if (t.tag === "c-grid-opps") oppLinks.push(...(m.links?.opportunities ?? []));
    }

    // One light-theme pass over the heaviest table page.
    log("- /compare (light)");
    const lightRes = await auditRoute(BASE + "/compare", "/compare", {
      light: true,
      name: "compare-light",
    });
    lightRes.path = "/compare (light)";
    results.push(lightRes);

    const opp = oppLinks[0];
    if (opp) {
      log(`- ${opp}`);
      results.push(await auditRoute(BASE + opp, opp));
    } else {
      log("! no opportunity link harvested; skipping /o route");
    }

    log("\n================ AUDIT RESULT ================");
    for (const r of results) {
      const flag = r.pageOverflow ? "OVERFLOW" : "ok      ";
      const mast = r.masthead?.scrolls ? " masthead-scrolls" : "";
      log(
        `[${flag}]${mast} ${r.path}  pageW=${r.pageScrollWidth} vw=${r.viewport}`
      );
      if (r.masthead?.scrolls) {
        log(`           masthead internal: ${r.masthead.scrollWidth} > ${r.masthead.clientWidth}`);
      }
      for (const o of r.offenders) {
        log(`           offender: <${o.tag} class="${o.cls}"> L${o.left} R${o.right} W${o.width}`);
      }
      for (const s of r.scrollContainers) {
        log(`           scroll-container: "${s.cls}" hidden=${s.overflowPx}px`);
      }
    }

    writeFileSync(
      join(OUT, `report-${WIDTH}.json`),
      JSON.stringify(results, null, 2)
    );
    log(`\nScreenshots + report: ${OUT}`);
  } finally {
    if (chrome) { try { chrome.child.kill(); } catch {} }
  }
}

main().catch((e) => {
  console.error("AUDIT FAILED:", e);
  process.exit(1);
});
