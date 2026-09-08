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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { RULES_FINGERPRINT } from "../src/lib/classify.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("\n  DATABASE_URL is not set.\n");
  process.exit(1);
}

/**
 * prepare:false is not optional here: this client goes through the Supavisor
 * transaction pooler, which does not support prepared statements. Without it
 * a tagged query intermittently never resolves - no error, just a hang
 * (found 2026-09-08: readiness sat silent for 10+ minutes while the same
 * queries through a prepare:false client returned in milliseconds). The
 * data.ts header has documented the pooler constraint since the start;
 * this client had silently missed it.
 */
const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15 });

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

/** A single numeric scalar, null on failure — never a misleading zero. */
async function scalar(q: string): Promise<number | null> {
  try {
    const rows = (await sql.unsafe(q)) as unknown as { n: string | number | null }[];
    const v = rows[0]?.n;
    return v == null ? null : Number(v);
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
  return rows[0]?.ok ?? false;
}

/** Is a pg_cron job present and active? A scheduled job is the only kind that runs. */
async function scheduled(jobname: string): Promise<boolean> {
  try {
    const rows = await sql<{ ok: boolean }[]>`
      select coalesce(bool_or(active), false) as ok
      from cron.job where jobname = ${jobname}`;
    return rows[0]?.ok ?? false;
  } catch {
    return false;
  }
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

  /**
   * Does the product layer keep up with the census layer?
   *
   * Search, categories, cards and the prober read `agents`/`agent_endpoints`,
   * never `registry_tokens`. Until 2026-09-06 those tables were populated only
   * by hand-run loaders: they froze at token #269686 while the census ran on to
   * #336715, and a freshly launched agent was censused yet invisible. The lag
   * between the two high-water marks is this failure, measured — a lag that
   * grows for days means the materialize cron has stopped again.
   */
  const regMax = await scalar("select max(token_id)::bigint as n from registry_tokens");
  const agentsMax = await scalar("select max(token_id)::bigint as n from agents where chain_id = 56");
  const matLag = regMax != null && agentsMax != null ? regMax - agentsMax : null;
  const matCron = await scheduled("gebo-materialize");
  gates.push({
    id: "materialize",
    item: "Census → agents materialization (surfaces read agents, not the census)",
    state: matCron && matLag != null && matLag <= 2000 ? "DONE" : matCron || matLag != null ? "PARTIAL" : "UNKNOWN",
    evidence:
      `census max #${fmt(regMax)}, agents max #${fmt(agentsMax)}, ` +
      `lag=${matLag == null ? "unmeasured" : `${fmt(matLag)} tokens`}, ` +
      `cron=${matCron ? "active" : "missing"}`,
  });

  /**
   * Can the taxonomy keep pace with the ecosystem?
   *
   * A hand-written taxonomy that cannot grow is a slow failure: it looks correct
   * on the day it ships and silently stops describing the chain. Three mechanisms
   * have to be in place, so all three are measured rather than assumed.
   */
  const rulesApplied = await count("agents", `classify_rules = '${RULES_FINGERPRINT}'`);
  const queued = await count(
    "agents",
    `(name is not null or description is not null or skills is not null)
       and (classify_rules is distinct from '${RULES_FINGERPRINT}'
            or (card_fetched_at is not null and card_fetched_at > coalesce(classified_at, 'epoch'::timestamptz)))`,
  );
  gates.push({
    id: "taxonomy-version",
    item: "Rule changes invalidate stale labels automatically",
    state: rulesApplied && rulesApplied > 0 && queued === 0 ? "DONE" : "PARTIAL",
    evidence: `rules ${RULES_FINGERPRINT}, applied=${fmt(rulesApplied)}, queued=${fmt(queued)}`,
  });

  /**
   * Classification into the four judged categories.
   *
   * DONE cannot mean unclassified === 0: most of the registry carries no
   * capability text at all, so there is nothing to classify and padding the
   * categories to reduce the number would violate the no-padding correction
   * recorded in AGENTS.md. What "done" honestly means here is that every agent
   * carrying evidence has been examined by the current rules - which is exactly
   * the queued === 0 condition measured above - plus at least one agent in
   * each of the four judged categories existing to serve.
   */
  const judgedCats = await sql<{ n: number }[]>`
    select count(distinct category)::int as n
    from agents where chain_id = 56 and category in ('rebalancing','grid','yield','health')`;
  const catsCovered = Number(judgedCats[0]?.n ?? 0);
  gates.push({
    id: "classify",
    item: "Capability classification into judged categories",
    state:
      judged && judged > 0 && catsCovered === 4 && queued === 0
        ? "DONE"
        : judged && judged > 0
          ? "PARTIAL"
          : "MISSING",
    evidence: `judged=${fmt(judged)}, categories covered=${catsCovered}/4, backlog=${fmt(queued)} (unmatched-by-rules is measured by classify:drift)`,
  });

  const emergingScheduled = await scheduled("gebo-emerging");
  const candidates = (await tableExists("category_candidates"))
    ? await count("category_candidates", "status = 'candidate'")
    : null;
  gates.push({
    id: "taxonomy-detect",
    item: "Emerging capabilities detected on a schedule, not by hand",
    state: emergingScheduled ? "DONE" : "MISSING",
    evidence: emergingScheduled
      ? `gebo-emerging active, open candidates=${fmt(candidates)}`
      : "no gebo-emerging cron job",
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
  const repCron = await scheduled("gebo-reputation");
  gates.push({
    id: "erc8004",
    item: "ERC-8004 Reputation Registry write-back",
    state: writes && writes > 0 && repCron ? "DONE" : writerLib ? "PARTIAL" : "MISSING",
    evidence: [
      `lib=${writerLib ? "yes" : "no"}`,
      `writer script=${writerScript ? "yes" : "no"}`,
      `reputation_writes=${writes === null ? "no table" : fmt(writes)}`,
      `cron=${repCron ? "active" : "missing (0030)"}`,
    ].join(", "),
  });

  /**
   * Agent Advantage runs: the counterfactual, with both arms measured.
   *
   * Added because it was missing, and its absence let me quote 19/21 in a status
   * report when the script had measured 17 - counting work that existed but was not
   * gated as though it were progress. A gate list that omits the mandatory
   * deliverable invites exactly that.
   */
  const advantage = (await tableExists("attestations"))
    ? await count(
        "attestations",
        `(baseline_duration_ms is not null or baseline_cost_amount is not null)
           and attester <> '0x0000000000000000000000000000000000000000'`,
      )
    : null;
  const advantageHighStakes = (await tableExists("attestations"))
    ? await count(
        "attestations a",
        `(a.baseline_duration_ms is not null)
           and a.attester <> '0x0000000000000000000000000000000000000000'
           and exists (
             select 1 from agents g
             where g.chain_id = a.chain_id and g.token_id = a.token_id
               and g.category in ('health','rebalancing','trading','grid','yield')
           )`,
      )
    : null;
  gates.push({
    id: "advantage",
    item: "Agent Advantage runs (>=3 tasks, both arms, high-stakes)",
    state:
      advantage != null && advantage >= 3 && (advantageHighStakes ?? 0) >= 1
        ? "DONE"
        : advantage && advantage > 0
          ? "PARTIAL"
          : "MISSING",
    evidence: `runs=${fmt(advantage)}, in a high-stakes category=${fmt(advantageHighStakes)}`,
  });

  /**
   * Trading track record: the rubric's win-rate/window/risk demand, measured
   * by replay for the grid reference agent.
   *
   * The grid_* rows self-expire after 26h so a broken refresh shows up HERE
   * (and on the agent card) rather than as a quietly outdated number.
   */
  const gridRecord = (await tableExists("metric_values"))
    ? await count("metric_values", "metric_id like 'grid\\_%'")
    : null;
  const gridRecordRoute = route("app/api/cron/grid-record/route.ts");
  gates.push({
    id: "grid-record",
    item: "Trading track record (grid agent, win rate + window + risk)",
    state:
      gridRecord != null && gridRecord >= 4 && gridRecordRoute
        ? "DONE"
        : gridRecord != null && gridRecord > 0
          ? "PARTIAL"
          : "MISSING",
    evidence: `grid_* rows=${gridRecord === null ? "no table" : fmt(gridRecord)}, refresh cron route=${gridRecordRoute ? "present" : "missing"}`,
  });

  /**
   * The reference agent has to be REACHABLE, not merely present.
   *
   * Five agents in this registry serve a valid card naming an endpoint only their
   * author can reach, so "the file exists" is not the property that matters. This
   * checks the routes are there; verify:agent checks the deployed card answers.
   */
  const refCard = route("app/api/agent/health/card/route.ts");
  const refA2A = route("app/api/agent/health/a2a/route.ts");
  gates.push({
    id: "reference-agent",
    item: "Reference health agent (card + A2A, publicly reachable)",
    state: refCard && refA2A ? "DONE" : "MISSING",
    evidence: refCard && refA2A ? "card and a2a routes present" : "missing route(s)",
  });

  const metrics = (await tableExists("metric_values")) ? await count("metric_values") : null;
  gates.push({
    id: "metrics",
    item: "metric_values (design law L2: no bare numbers)",
    state: metrics && metrics > 0 ? "DONE" : metrics === 0 ? "PARTIAL" : "MISSING",
    evidence: metrics === null ? "no metric_values table" : `metric_values=${fmt(metrics)}`,
  });

  /**
   * Landing aggregates are served from registry_counts (one row, primary
   * key) since 2026-09-07, because the direct aggregate measured 9.8s cold
   * against the 9s render timeout and first-time visitors got the
   * invariant-9 banner as the default state of the headline numbers. The
   * table refreshes by DIRECT pg_cron SQL (gebo-counts, every 5 min) - no
   * HTTP hop, so a succeeded run really ran, unlike the pg_net routes
   * where queueing is not execution (the 0024 failure mode).
   */
  const countsAgeMin = await scalar(
    "select floor(extract(epoch from (now() - computed_at)) / 60)::int as n from registry_counts where id = 'bsc'",
  );
  const countsCron = await scheduled("gebo-counts");
  gates.push({
    id: "counts-table",
    item: "Landing aggregates served from registry_counts (cold-start safe)",
    state:
      countsAgeMin != null && countsAgeMin <= 35 && countsCron
        ? "DONE"
        : countsCron || countsAgeMin != null
          ? "PARTIAL"
          : "MISSING",
    evidence:
      `row age=${countsAgeMin == null ? "no row (direct query in use)" : `${countsAgeMin} min`}, ` +
      `gebo-counts cron=${countsCron ? "active" : "missing"} (*/15 since 0037)`,
  });

  /**
   * Keystore session index (migration 0034): third-party sessions from
   * on-chain logs, verified per-wallet through the same reads the authority
   * console uses. The cron is HTTP-routed, so a missing deploy shows up as
   * failed runs rather than silence.
   */
  const sessionCron = await scheduled("gebo-sessions");
  const sessionRowsAll = await sql<{ n: number }[]>`
    select count(*)::int as n from sessions where source = 'chain-index'`.catch(() => [{ n: 0 }] as { n: number }[]);
  const sessionRows = sessionRowsAll?.[0]?.n ?? 0;
  gates.push({
    id: "session-index",
    item: "Keystore session index (third-party sessions, mainnet)",
    state: sessionCron && sessionRows > 0 ? "DONE" : sessionCron ? "PARTIAL" : "MISSING",
    evidence:
      `gebo-sessions cron=${sessionCron ? "active" : "missing"}, chain-index rows=${sessionRows}` +
      (sessionCron && sessionRows === 0 ? " (index live; no third-party Keystore activity observed yet - the mainnet Keystore is quiet, and public RPC depth bounds history to the free window)" : ""),
  });

  /**
   * Paper mode (migration 0036): the reference agent's zero-spend decision
   * loop, recorded and scored publicly at /paper.
   */
  const paperCron = await scheduled("gebo-paper");
  const paperRunsAll = await sql<{ n: number }[]>`
    select count(*)::int as n from paper_runs`.catch(() => [{ n: 0 }] as { n: number }[]);
  const paperRuns = paperRunsAll?.[0]?.n ?? 0;
  gates.push({
    id: "paper-mode",
    item: "Paper mode (zero-spend decision loop, recorded and scored)",
    state: paperCron && paperRuns > 0 ? "DONE" : paperCron ? "PARTIAL" : "MISSING",
    evidence: `gebo-paper cron=${paperCron ? "active" : "missing"}, runs=${paperRuns}`,
  });

  /**
   * Live Altana sessions, granted rather than described - measured ONCHAIN.
   *
   * The Altana bounty disqualifies submissions that cannot show live onchain
   * sessions/transactions in the explorer. The old gate counted our own rows
   * (state='active' and expiry>now), which is bookkeeping: the state column
   * is not swept, and the chain is the only source of truth the judges can
   * check. So the gate now reads getKeys/isValidKey per grant wallet through
   * the same readAuthority() the authority console uses, and reports the DB
   * count alongside for contrast. Thresholds unchanged: 4+ chain-valid keys
   * (one per judged category) is DONE, 1-3 PARTIAL.
   */
  const grantWallets = (await tableExists("sessions"))
    ? await sql<{ chain_id: number; wallet_address: string }[]>`
      select distinct chain_id, wallet_address
      from sessions
      where grant_tx_hash is not null`
    : [];
  const totalSessions = (await tableExists("sessions"))
    ? await count("sessions", "grant_tx_hash is not null")
    : null;
  let onchainValid = 0;
  let onchainNote = "";
  if (grantWallets.length > 0) {
    const { readAuthority, isAddress } = await import("../src/lib/keystore.ts");
    for (const w of grantWallets) {
      if (!isAddress(w.wallet_address)) continue;
      if (w.chain_id !== 56 && w.chain_id !== 97) continue;
      const auth = await readAuthority(w.wallet_address, w.chain_id);
      if (auth.error) {
        onchainNote += ` chain read failed (${w.chain_id}): ${auth.error.slice(0, 60)};`;
        continue;
      }
      onchainValid += auth.activeKeys;
    }
  }
  const onchainKnown = grantWallets.length > 0 && !onchainNote;
  gates.push({
    id: "altana-sessions",
    item: "Live scoped Altana sessions (chain-valid keys, via getKeys/isValidKey)",
    state: !onchainKnown
      ? "MISSING"
      : onchainValid >= 4 ? "DONE" : onchainValid > 0 ? "PARTIAL" : "MISSING",
    evidence:
      grantWallets.length === 0
        ? "no sessions table"
        : `${fmt(onchainValid)} chain-valid key(s) across ${fmt(grantWallets.length)} grant wallet(s), ${fmt(totalSessions)} grant tx(s) recorded. Sessions expire <=48h by design.${onchainNote ? ` ${onchainNote}` : ""}`,
  });

  /**
   * No SECURITY DEFINER function may be executable by PUBLIC.
   *
   * Measured rather than trusted, because the obvious fix silently did not work.
   * Migration 0005 carried "revoke all on function gebo_secret(text) from anon,
   * authenticated" and it changed nothing: Postgres grants EXECUTE to PUBLIC by
   * default, anon inherits through PUBLIC, and revoking the named roles leaves the
   * real grant in place. gebo_secret reads vault.decrypted_secrets and Supabase
   * exposes public-schema functions over PostgREST, so that was a route to the
   * cron bearer token from outside the database for as long as it stood.
   *
   * An empty grantee before "=" in the ACL is the PUBLIC grant; a null ACL is the
   * default, which also includes PUBLIC.
   */
  try {
    const secdef = await sql<{ name: string; args: string; acl: string | null }[]>`
      select p.proname as name,
             pg_get_function_identity_arguments(p.oid) as args,
             array_to_string(p.proacl, ' | ') as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by p.proname`;
    const open = secdef.filter((r) => !r.acl || /(^|\| )=/.test(r.acl));
    gates.push({
      id: "definer-acl",
      item: "No SECURITY DEFINER function executable by PUBLIC",
      state: open.length === 0 ? "DONE" : "MISSING",
      evidence:
        open.length === 0
          ? `${secdef.length} definer function(s), all restricted`
          : `EXPOSED: ${open.map((r) => `${r.name}(${r.args})`).join(", ")}`,
    });
  } catch (e) {
    gates.push({
      id: "definer-acl",
      item: "No SECURITY DEFINER function executable by PUBLIC",
      state: "UNKNOWN",
      evidence: `could not read pg_proc: ${String((e as Error).message).slice(0, 60)}`,
    });
  }

  // ------------------------------------------------- published figures freshness
  // docs/MEASUREMENTS.md embeds a generated block whose figures move daily.
  // It regenerates only when someone runs scripts/write-measurements.ts, so
  // without a gate it silently ships stale numbers (found 4 days stale,
  // 2026-08-30). A scheduled GitHub Action refreshes it; this gate catches the
  // case where that action has not run - failed schedule, disabled repo
  // Actions, or a checkout regenerated from an old branch.
  {
    const MEASUREMENTS_MAX_AGE_HOURS = 48;
    let state: Gate["state"] = "UNKNOWN";
    let evidence = "";
    try {
      const md = readFileSync("docs/MEASUREMENTS.md", "utf8");
      const m = md.match(/Census measured at ([0-9-]+ [0-9:]+) UTC/);
      // The offline CENSUS_FALLBACK snapshot in src/lib/data.ts is generated
      // by the same script on the same schedule, and was found 11 days stale
      // the same day. Freshness is gated together.
      const data = readFileSync("src/lib/data.ts", "utf8");
      const f = data.match(/measuredAt: "([0-9-]+)"/);
      if (!m || !f) {
        state = "MISSING";
        evidence = !m
          ? "generated block not found in docs/MEASUREMENTS.md"
          : "CENSUS_FALLBACK measuredAt not found in src/lib/data.ts";
      } else {
        const stamp = m[1] ?? "";
        const docAge = (Date.now() - Date.parse(`${stamp.replace(" ", "T")}Z`)) / 3_600_000;
        const fbAge = (Date.now() - Date.parse(`${f[1]}T00:00:00Z`)) / 3_600_000;
        if (Number.isNaN(docAge) || Number.isNaN(fbAge)) {
          state = "UNKNOWN";
          evidence = `unparseable timestamps: doc=${stamp} fallback=${f[1]}`;
        } else if (docAge > MEASUREMENTS_MAX_AGE_HOURS || fbAge > MEASUREMENTS_MAX_AGE_HOURS) {
          state = "MISSING";
          evidence = `stale: doc block ${Math.floor(docAge)}h old, fallback ${Math.floor(fbAge)}h old (max ${MEASUREMENTS_MAX_AGE_HOURS}h) - run npx tsx scripts/write-measurements.ts`;
        } else {
          state = "DONE";
          evidence = `doc block ${Math.floor(docAge)}h old, fallback ${Math.floor(fbAge)}h old (max ${MEASUREMENTS_MAX_AGE_HOURS}h)`;
        }
      }
    } catch (e) {
      state = "UNKNOWN";
      evidence = `could not read docs/MEASUREMENTS.md: ${String((e as Error).message).slice(0, 60)}`;
    }
    gates.push({
      id: "measurements-fresh",
      item: "Generated figure blocks (docs + fallback snapshot) are fresh",
      state,
      evidence,
    });
  }

  // ------------------------------------------------- env documentation coverage
  // .env.example is documentation, and documentation rots the same way the
  // measurements block did: a var gets read in code but never documented, and
  // the next deployment discovers it in production (X402_PAY_TO went missing
  // exactly this way - the paid route silently fell back to the facilitator
  // address and settlement became a self-transfer). Scan what the code reads
  // and require each var to appear in .env.example, minus platform-provided
  // vars that no .env can supply anyway.
  {
    const PLATFORM_PROVIDED = new Set([
      "NODE_ENV", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_REGION",
    ]);
    let state: Gate["state"] = "UNKNOWN";
    let evidence = "";
    try {
      const example = readFileSync(".env.example", "utf8");
      const documented = new Set(
        [...example.matchAll(/^([A-Z_0-9]+)=/gm)].map((m) => m[1]!),
      );
      const read = new Set<string>();
      const roots = ["app", "src", "scripts"];
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = `${dir}/${e.name}`;
          if (e.isDirectory()) walk(p);
          else if (/\.(ts|tsx|mts)$/.test(e.name)) {
            const src = readFileSync(p, "utf8");
            for (const m of src.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
              read.add(m[1]!);
            }
          }
        }
      };
      for (const r of roots) if (existsSync(r)) walk(r);

      const missing = [...read]
        .filter((v) => !documented.has(v) && !PLATFORM_PROVIDED.has(v))
        .sort();
      if (missing.length === 0) {
        state = "DONE";
        evidence = `${read.size} env vars read by code, all documented (or platform-provided)`;
      } else {
        state = "MISSING";
        evidence = `read in code but absent from .env.example: ${missing.join(", ")}`;
      }
    } catch (e) {
      state = "UNKNOWN";
      evidence = `could not scan env coverage: ${String((e as Error).message).slice(0, 60)}`;
    }
    gates.push({
      id: "env-docs",
      item: ".env.example documents every var the code reads",
      state,
      evidence,
    });
  }

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
