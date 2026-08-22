/**
 * Production-readiness audit, measured rather than remembered.
 *
 * Exists because a long session was lost and the written plan could not say which
 * items were actually done. A checklist kept by hand drifts from the system it
 * describes; this reads the database and the filesystem instead, so `npm run
 * readiness` is always the current truth and never yesterday's intention.
 *
 * Every gate states what it measured. A gate that cannot be measured says so
 * rather than passing quietly.
 */
import "dotenv/config";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("\n  DATABASE_URL is not set.\n");
  process.exit(1);
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

type Gate = {
  id: string;
  item: string;
  state: "DONE" | "PARTIAL" | "MISSING" | "UNKNOWN";
  evidence: string;
};

const gates: Gate[] = [];

/** A count that fails loudly rather than returning a misleading zero. */
async function count(table: string, where?: string): Promise<number | null> {
  try {
    const q = where
      ? `select count(*)::int as n from ${table} where ${where}`
      : `select count(*)::int as n from ${table}`;
    const rows = (await sql.unsafe(q)) as unknown as { n: number }[];
    return rows[0]?.n ?? null;
  } catch {
    return null;
  }
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = ${table}
    ) as ok`;
  return Boolean(rows[0]?.ok);
}

function route(path: string): boolean {
  return existsSync(path);
}

async function main() {
  // ---------------------------------------------------------------- data spine
  const tokens = await count("registry_tokens");
  const probes = await count("probes_raw");
  const verified = await count("agents", "trust_state = 'VERIFIED'");
  const judged = await count(
    "agents",
    "category in ('rebalancing','grid','yield','health')",
  );
  const unclassified = await count("agents", "category is null");
  const opps = await count("opportunities");

  gates.push({
    id: "spine",
    item: "Registry census + resolve + probe pipeline",
    state: tokens && tokens > 100_000 ? "DONE" : tokens ? "PARTIAL" : "UNKNOWN",
    evidence: `registry_tokens=${fmt(tokens)}, probes_raw=${fmt(probes)}, VERIFIED=${fmt(verified)}`,
  });

  gates.push({
    id: "classify",
    item: "Capability classification into judged categories",
    state: judged && judged > 0 ? (unclassified === 0 ? "DONE" : "PARTIAL") : "MISSING",
    evidence: `judged=${fmt(judged)}, unclassified=${fmt(unclassified)}`,
  });

  gates.push({
    id: "opportunities",
    item: "Opportunity index (what an agent could act on)",
    state: opps && opps > 0 ? "DONE" : opps === 0 ? "PARTIAL" : "MISSING",
    evidence: `opportunities=${fmt(opps)}`,
  });

  // ---------------------------------------------------------------- surfaces
  const surfaces: [string, string][] = [
    ["Landing page (three-number reframe)", "app/page.tsx"],
    ["Agent card", "app/a/[tokenId]/page.tsx"],
    ["Hire / scope picker", "app/a/[tokenId]/hire/page.tsx"],
    ["Category surface", "app/c/[category]/page.tsx"],
    ["Search", "app/search/page.tsx"],
    ["Liveness ledger", "app/live/page.tsx"],
    ["Authority console", "app/authority/page.tsx"],
    ["Methodology", "app/methodology/page.tsx"],
    ["Counterfactual compare", "app/compare/page.tsx"],
    ["Opportunity detail", "app/o/[id]/page.tsx"],
  ];
  for (const [label, path] of surfaces) {
    gates.push({
      id: "route",
      item: label,
      state: route(path) ? "DONE" : "MISSING",
      evidence: path,
    });
  }

  // ---------------------------------------------------------------- claims
  const attest = (await tableExists("attestations")) ? await count("attestations") : null;
  gates.push({
    id: "attest",
    item: "Attestations (feedback behind an evidence gate)",
    state: attest === null ? "MISSING" : attest > 0 ? "DONE" : "PARTIAL",
    evidence:
      attest === null
        ? "no attestations table"
        : `attestations=${fmt(attest)}${attest === 0 ? " (gate built, never exercised in prod)" : ""}`,
  });

  const attestOnCard =
    existsSync("app/a/[tokenId]/page.tsx") &&
    readFileSync("app/a/[tokenId]/page.tsx", "utf8").toLowerCase().includes("attestation");
  gates.push({
    id: "attest-ui",
    item: "Attestations visible on the agent card",
    state: attestOnCard ? "DONE" : "MISSING",
    evidence: attestOnCard ? "referenced in agent page" : "agent page never mentions attestations",
  });

  const reviewers = (await tableExists("reviewers")) ? await count("reviewers") : null;
  gates.push({
    id: "reviewers",
    item: "Reviewer trust set (who may attest)",
    state: reviewers && reviewers > 0 ? "DONE" : reviewers === 0 ? "PARTIAL" : "MISSING",
    evidence: `reviewers=${fmt(reviewers)}`,
  });

  const writes = (await tableExists("reputation_writes")) ? await count("reputation_writes") : null;
  const writerLib = route("src/lib/reputation.ts");
  const writerScript = route("scripts/write-reputation.ts");
  gates.push({
    id: "erc8004",
    item: "ERC-8004 Reputation Registry write-back",
    state: writes && writes > 0 ? "DONE" : writerLib ? "PARTIAL" : "MISSING",
    evidence: [
      `lib=${writerLib ? "yes" : "no"}`,
      `writer script=${writerScript ? "yes" : "no"}`,
      `reputation_writes=${writes === null ? "no table" : fmt(writes)}`,
    ].join(", "),
  });

  const metrics = (await tableExists("metric_values")) ? await count("metric_values") : null;
  gates.push({
    id: "metrics",
    item: "metric_values (design law L2: no bare numbers)",
    state: metrics && metrics > 0 ? "DONE" : metrics === 0 ? "PARTIAL" : "MISSING",
    evidence: metrics === null ? "no metric_values table" : `metric_values=${fmt(metrics)}`,
  });

  // ---------------------------------------------------------------- print
  const pad = Math.max(...gates.map((g) => g.item.length));
  const order = { MISSING: 0, PARTIAL: 1, UNKNOWN: 2, DONE: 3 };
  const mark = { DONE: "  ok ", PARTIAL: " part", MISSING: " MISS", UNKNOWN: "  ?  " };

  console.log("\n  GEBO production readiness\n  " + "-".repeat(pad + 34));
  for (const g of [...gates].sort((a, b) => order[a.state] - order[b.state])) {
    console.log(`  ${mark[g.state]}  ${g.item.padEnd(pad)}  ${g.evidence}`);
  }

  const done = gates.filter((g) => g.state === "DONE").length;
  console.log(`\n  ${done}/${gates.length} gates pass.\n`);

  await sql.end();
}

function fmt(n: number | null): string {
  return n === null ? "n/a" : n.toLocaleString("en-US");
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
