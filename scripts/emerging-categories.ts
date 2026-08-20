/**
 * Emerging-capability detector.
 *
 * The taxonomy is nine hand-written rule sets, so a genuinely new capability on
 * BNB Chain gets classified as null and nobody notices. For something meant to be
 * the front door for every agent on the chain, silently ignoring a new category
 * is a real failure mode - the ecosystem will produce capabilities nobody has
 * thought of yet.
 *
 * WHY THIS DOES NOT AUTO-CREATE CATEGORIES.
 *
 * Auto-creating a category from term frequency produces garbage. The most common
 * terms in this corpus are "bsc", "defi", "agent" and "bnb" - venue and buzzword
 * noise, not capabilities. An automatic taxonomy would spawn a "defi" category
 * containing thousands of unrelated agents, which is worse than leaving them
 * unclassified because it looks authoritative.
 *
 * So this surfaces CANDIDATES with their evidence and lets a person decide. The
 * taxonomy grows deliberately, on measurement rather than guesswork - which is
 * the same standard the rest of the project holds itself to.
 *
 * Run: npx tsx scripts/emerging-categories.ts
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });

/**
 * Terms already covered by a rule, plus venue and buzzword noise. Anything here
 * is expected and uninteresting; what is left is the signal.
 */
const KNOWN = new Set([
  // rule vocabulary
  "rebalance", "rebalancing", "rebalancer", "liquidity", "concentrated", "range",
  "grid", "scalping", "scalp", "ladder", "martingale", "spread",
  "yield", "apy", "apr", "compound", "compounding", "venus", "aave", "lista", "staking", "stake",
  "health", "factor", "liquidation", "liquidated", "collateral", "ltv", "borrow", "debt", "repay",
  "trade", "trading", "trader", "swap", "swaps", "buy", "sell", "dca", "snipe", "memecoin",
  "research", "analysis", "analytics", "screener", "sentiment", "intelligence", "odds", "prediction",
  "payment", "payments", "escrow", "invoice", "payout", "settlement", "x402", "erc8183",
  "social", "twitter", "telegram", "discord", "community", "engagement",
  "registry", "identity", "erc8004", "wallet", "explorer", "indexer", "rpc",
  // venue and buzzword noise: common, uninformative
  "bsc", "bnb", "chain", "defi", "agent", "agents", "ai", "onchain", "on", "the", "and", "for",
  "with", "your", "you", "a", "an", "to", "of", "in", "is", "it", "this", "that", "from", "by",
  "token", "tokens", "crypto", "web3", "protocol", "network", "smart", "contract", "blockchain",
  "autonomous", "automated", "bot", "assistant", "powered", "using", "via", "based", "live",
  "real", "time", "data", "api", "http", "json", "rpc", "test", "demo", "new", "my", "me",
]);

const STOP = /^(?:[0-9]+|.{1,2})$/;

type Row = {
  name: string | null;
  description: string | null;
  skills: string[] | null;
  trust_state: string;
  operator_domain: string | null;
};

try {
  const rows = await sql<Row[]>`
    select a.name, a.description, a.skills, a.trust_state,
           o.registrable_domain as operator_domain
    from agents a
    left join operators o on o.key = a.operator_key
    where a.chain_id = 56
      and a.category is null
      and (a.skills is not null or a.description is not null)
  `;

  const totals = await sql<{ n: number; withtext: number }[]>`
    select
      count(*)::int as n,
      count(*) filter (where skills is not null or description is not null)::int as withtext
    from agents where chain_id = 56 and category is null
  `;
  const tot = totals[0] ?? { n: 0, withtext: 0 };

  console.log(`\n  UNCLASSIFIED AGENTS`);
  console.log(`    total unclassified        ${Number(tot.n).toLocaleString()}`);
  console.log(`    of those, with any text   ${Number(tot.withtext).toLocaleString()}`);
  console.log(`    examined here             ${rows.length.toLocaleString()}`);

  if (!rows.length) {
    console.log(`\n  Nothing unclassified carries capability text, so there is no evidence`);
    console.log(`  of a missing category. The taxonomy covers what the corpus describes.\n`);
    await sql.end();
    process.exit(0);
  }

  /**
   * Operator brand names are not capabilities.
   *
   * The first run of this script nominated "unibase" as a candidate category on
   * 20 verified agents. Unibase is an operator, not a job. Domain labels and
   * their parts are therefore excluded.
   */
  const brandTokens = new Set<string>();
  for (const r of rows) {
    if (!r.operator_domain) continue;
    for (const part of r.operator_domain.toLowerCase().split(/[.\-]/)) {
      if (part.length > 2) brandTokens.add(part);
    }
  }

  /**
   * Count DISTINCT capability text, not agents.
   *
   * Mass-minted agents share one description verbatim. The first run counted a
   * single poetic sentence ("Black Swan does not represent the moment everything
   * changes") as six independent pieces of evidence and nominated "swan",
   * "nonviolent" and "vitable" as candidate categories. One author writing one
   * sentence is one observation, however many identities repeat it.
   */
  const seenText = new Set<string>();
  const freq = new Map<string, { docs: number; verified: number; examples: Set<string> }>();

  for (const r of rows) {
    const text = [r.name ?? "", r.description ?? "", ...(r.skills ?? [])].join(" ");
    const fingerprint = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!fingerprint || seenText.has(fingerprint)) continue;
    seenText.add(fingerprint);

    const terms = new Set(
      fingerprint
        .replace(/[_\-/.,;:()[\]{}|"'`]+/g, " ")
        .split(/\s+/)
        .filter((t) => t && !STOP.test(t) && !KNOWN.has(t) && !brandTokens.has(t)),
    );
    for (const t of terms) {
      const e = freq.get(t) ?? { docs: 0, verified: 0, examples: new Set<string>() };
      e.docs++;
      if (r.trust_state === "VERIFIED") e.verified++;
      if (e.examples.size < 3 && r.name) e.examples.add(r.name.slice(0, 28));
      freq.set(t, e);
    }
  }

  console.log(`    distinct capability texts ${seenText.size.toLocaleString()}  (duplicates collapsed)`);

  const candidates = [...freq.entries()]
    .filter(([, e]) => e.docs >= 3)
    .sort((a, b) => b[1].verified - a[1].verified || b[1].docs - a[1].docs)
    .slice(0, 25);

  console.log(`\n  CANDIDATE TERMS NOT COVERED BY ANY RULE`);
  console.log(`  ${"term".padEnd(22)} ${"texts".padStart(6)} ${"verified".padStart(9)}  examples`);
  if (!candidates.length) {
    console.log(`    none: no term appears in three or more DISTINCT capability texts`);
  }
  for (const [term, e] of candidates) {
    console.log(
      `  ${term.slice(0, 21).padEnd(22)} ${String(e.docs).padStart(6)} ${String(e.verified).padStart(9)}  ` +
      [...e.examples].join(", ").slice(0, 42),
    );
  }

  const strong = candidates.filter(([, e]) => e.verified >= 3);
  console.log(`\n  ASSESSMENT`);
  if (!strong.length) {
    console.log(`    No term appears in three or more distinct capability texts from verified`);
    console.log(`    agents. There is no evidence of a missing category: unclassified agents`);
    console.log(`    are listings without usable capability text, not an unmet need.`);
  } else {
    console.log(`    ${strong.length} term(s) clear the bar. Candidates for a new rule set, to be`);
    console.log(`    added after reading the agents behind them - never auto-created, because`);
    console.log(`    frequency alone nominates operator names and stray prose.`);
    for (const [t, e] of strong.slice(0, 6)) {
      console.log(`      ${t.padEnd(20)} ${e.docs} texts, ${e.verified} verified  e.g. ${[...e.examples][0] ?? "-"}`);
    }
  }
  console.log("");
} catch (e: any) {
  console.error(`\n  FAILED: ${String(e?.message ?? e).slice(0, 240)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
