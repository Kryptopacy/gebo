/**
 * Capability classification.
 *
 * Written after measuring the corpus rather than before. The counts that shaped
 * this (over 21,278 indexed agents, from name + description + A2A card skills):
 *
 *   rebalanc        3        trading      103
 *   concentrated    1        swap          74
 *   grid            5        monitor       74
 *   health factor   1        portfolio     69
 *   liquidat        1        price         69
 *   venus/aave      3
 *
 * The four judged categories are therefore almost unserved on BNB Chain, and the
 * dominant real capability is generic on-chain trading. Two consequences shape
 * the design:
 *
 *  1. ABSENCE IS THE FINDING. Padding the categories by classifying every
 *     PancakeSwap trading agent as a "grid trader" would manufacture coverage
 *     and mislead exactly the hire decision this product exists to inform. So a
 *     judged category is assigned only on real evidence, and adjacent
 *     capabilities get their own honest labels.
 *
 *  2. SUBSTRING MATCHING IS UNSAFE. Bare "lp" matched 192 agents through words
 *     like "help" and "alpha". Single words are matched on word boundaries;
 *     only multi-word phrases are matched as substrings.
 *
 * Evidence is recorded with every assignment so a listing can show why it was
 * categorised, and a reader can disagree.
 */

export type JudgedCategory = "rebalancing" | "grid" | "yield" | "health";
export type AdjacentCategory = "trading" | "research" | "payments" | "social" | "infra";
export type AnyCategory = JudgedCategory | AdjacentCategory;

export type Classification = {
  category: AnyCategory | null;
  judged: boolean;
  /** 0-1. Skills outrank descriptions, which outrank names. */
  confidence: number;
  matched: string[];
  /** Which field carried the evidence. */
  source: "skills" | "description" | "name" | null;
};

type Rule = {
  category: AnyCategory;
  judged: boolean;
  /** Multi-word phrases and stems, matched as substrings. Strong evidence. */
  phrases: string[];
  /**
   * Single words that are category-defining on their own. "grid" means grid
   * trading; nothing else uses it.
   */
  strongWords: string[];
  /**
   * Single words that support a match but cannot carry one. "yield", "venus" and
   * "trade" appear across unrelated agents, and letting them stand alone inflated
   * yield to 36 agents and grid to 93 by absorbing generic trading bots. A judged
   * category now requires a phrase or a strong word; weak words only corroborate.
   */
  weakWords: string[];
};

const RULES: Rule[] = [
  {
    category: "rebalancing",
    judged: true,
    phrases: [
      "rebalanc", "re range", "reranging",
      "concentrated liquidity", "liquidity position", "lp position", "lp range",
      "tick range", "out of range", "position manager", "v3 liquidity",
      "liquidity management", "provide liquidity", "withdraw liquidity",
    ],
    strongWords: ["rebalancer", "reranger"],
    weakWords: ["liquidity", "range"],
  },
  {
    category: "grid",
    judged: true,
    /**
     * Deliberately narrow. An earlier version included dca, "buy the dip",
     * "take profit" and "stop loss", which pushed grid from 33 to 93 agents by
     * absorbing every generic trading bot. Those are ordinary trading
     * behaviours: grid trading places a ladder of orders across a range,
     * whereas DCA buys at intervals regardless of price. They now sit under
     * `trading`, where they belong. Inflating a judged category with adjacent
     * behaviour would corrupt the hire decision this product exists to inform.
     */
    phrases: [
      "grid bot", "grid trading", "grid order", "grid strategy", "grid range",
      "range trading", "trading range", "market making", "market maker",
      "spread capture", "ladder order", "order ladder", "martingale",
      "both sides of the book",
    ],
    strongWords: ["grid", "scalping"],
    weakWords: ["scalp", "range"],
  },
  {
    category: "yield",
    judged: true,
    phrases: [
      "yield optimi", "yield optimisation", "yield optimization", "yield strateg", "yield farm", "best rate", "highest apr",
      "highest apy", "auto-compound", "autocompound", "auto compound",
      "supply rate", "lending yield", "liquid staking", "staking yield",
      "interest rate", "deposit and earn",
    ],
    strongWords: [],
    weakWords: ["apy", "apr", "yield", "venus", "aave", "lista", "compounding"],
  },
  {
    category: "health",
    judged: true,
    phrases: [
      "health factor", "health factor monitoring",
      "liquidat",
      "collateral ratio", "collateralisation", "collateralization",
      "margin call", "loan health", "position at risk",
      "repay debt", "repay your", "repays before",
      "borrow position", "watches your loan", "protect my loan",
    ],
    strongWords: ["ltv", "undercollateral"],
    weakWords: ["collateral", "borrow", "debt"],
  },

  // Adjacent capabilities. Real, common, and NOT one of the judged four - so
  // they are labelled for what they are rather than promoted into a category.
  {
    category: "trading",
    judged: false,
    /**
     * Where ordinary trading behaviour belongs, including the strategies that
     * were wrongly inflating `grid`. Naming these honestly is more useful to a
     * user than mislabelling them as one of the four judged jobs.
     */
    phrases: [
      "on-chain trading", "buy and sell", "token trading", "trade tokens",
      "swap tokens", "execute trades", "copy trade", "copytrading",
      "snipe", "memecoin", "four.meme", "fourmeme",
      "dollar cost average", "dollar-cost", "take profit", "stop loss",
      "tp-sl", "buy the dip", "sells the rips", "arbitrage",
    ],
    strongWords: [],
    weakWords: ["swap", "trade", "trading", "trader", "dca"],
  },
  {
    category: "research",
    judged: false,
    phrases: [
      "market analysis", "token analysis", "price analysis", "technical analysis",
      "sentiment analys", "market intelligence", "due diligence", "risk screening",
      "token screener", "trending token", "odds", "prediction", "research",
    ],
    strongWords: [],
    weakWords: ["analytics", "analysis", "screener", "sentiment", "intelligence"],
  },
  {
    category: "payments",
    judged: false,
    phrases: [
      "x402", "erc-8183", "erc8183", "job escrow", "invoice", "payout",
      "micropayment", "pay per call", "settlement", "subscription",
    ],
    strongWords: [],
    weakWords: ["escrow", "payments", "payment", "billing"],
  },
  {
    category: "social",
    judged: false,
    phrases: [
      "social intelligence", "social interaction", "community management",
      "engagement", "twitter", "telegram", "discord", "kol",
    ],
    strongWords: [],
    weakWords: [],
  },
  {
    category: "infra",
    judged: false,
    phrases: [
      "agent registry", "erc-8004", "erc8004", "agent identity", "deploy agent",
      "create agent", "agent discovery", "wallet tracker", "block explorer",
      "rpc", "indexer",
    ],
    strongWords: [],
    weakWords: [],
  },
];

/** Escape a term for safe use inside a RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalise before matching.
 *
 * Agents tag themselves with hyphenated slugs - "health-factor-monitoring",
 * "yield-optimisation", "grid-trading" - which are the most precise capability
 * statements in the corpus and were being missed entirely, because a hyphen is
 * not a space. HealthGuard classified as yield off a bare "venus" hit while its
 * own skills said "health-factor-monitoring" and "repays before it can be
 * liquidated".
 *
 * Separators collapse to spaces so slugs and prose match the same rules.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-/.,;:()[\]{}|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-boundary match, so "lp" cannot match "help" or "alpha". */
function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${esc(word)}\\b`, "i").test(haystack);
}

function scoreAgainst(text: string, rule: Rule): { hits: string[]; specific: number } {
  if (!text) return { hits: [], specific: 0 };
  const lower = normalise(text);
  const hits: string[] = [];
  let specific = 0;

  // Phrases are substring matches, so they double as stems: "liquidat" catches
  // both "liquidation" and "liquidated", which a word match would not.
  for (const p of rule.phrases) if (lower.includes(normalise(p))) { hits.push(p); specific++; }
  // Category-defining single words count as specific evidence.
  for (const w of rule.strongWords) if (hasWord(lower, w)) { hits.push(w); specific++; }
  // Supporting words corroborate but cannot carry a judged claim on their own.
  for (const w of rule.weakWords) if (hasWord(lower, w)) hits.push(w);

  return { hits, specific };
}

export type ClassifyInput = {
  name?: string | null;
  description?: string | null;
  skills?: string[] | null;
};

/**
 * Classify from the strongest available evidence.
 *
 * Skills come from the agent's own A2A card and are checked first; a match there
 * is worth more than one in a name, because names in this ecosystem are things
 * like "premium", "ala" and "Professor". A judged category always wins over an
 * adjacent one when both match, since the adjacent labels exist to catch what
 * is left over, not to compete.
 */
export function classifyCapability(input: ClassifyInput): Classification {
  const sources: { source: Classification["source"]; text: string; weight: number }[] = [
    { source: "skills", text: (input.skills ?? []).join(" \n "), weight: 1.0 },
    { source: "description", text: input.description ?? "", weight: 0.8 },
    { source: "name", text: input.name ?? "", weight: 0.5 },
  ];

  let best: (Classification & { specific: number }) | null = null;

  for (const s of sources) {
    if (!s.text.trim()) continue;
    for (const rule of RULES) {
      const { hits, specific } = scoreAgainst(s.text, rule);
      if (!hits.length) continue;

      // A judged category is a claim about what an agent DOES, so it requires
      // specific evidence: a phrase, or a category-defining word. Corroborating
      // words alone fall through to an adjacent label or to unclassified.
      if (rule.judged && specific === 0) continue;

      // More distinct hits is stronger, with diminishing returns past three.
      const strength = Math.min(hits.length, 3) / 3;
      const confidence = Number((s.weight * (0.55 + 0.45 * strength)).toFixed(3));

      const candidate = {
        category: rule.category,
        judged: rule.judged,
        confidence,
        matched: [...new Set(hits)].slice(0, 6),
        source: s.source,
        specific,
      };

      if (!best) { best = candidate; continue; }

      // A judged category outranks an adjacent one regardless of confidence.
      if (candidate.judged !== best.judged) {
        if (candidate.judged) best = candidate;
        continue;
      }

      /**
       * Between two judged categories, prefer the more SPECIFIC evidence.
       *
       * Protocol names are genuinely ambiguous: Venus serves both supplying
       * (yield) and borrowing (health factor), so a bare "venus" hit classified
       * "HealthGuard" as yield. A multi-word phrase like "health factor" states
       * the job; a single protocol name only names the venue. Phrase matches
       * therefore win before confidence is considered.
       */
      if (candidate.specific !== best.specific) {
        if (candidate.specific > best.specific) best = candidate;
        continue;
      }

      if (candidate.confidence > best.confidence) best = candidate;
    }
    // Stop at the strongest source that produced a judged match on a phrase.
    if (best?.judged && best.specific > 0) break;
  }

  if (!best) return { category: null, judged: false, confidence: 0, matched: [], source: null };
  const { specific: _drop, ...result } = best;
  return result;
}

/** Human labels for display. Adjacent labels state plainly what they are. */
export const CATEGORY_LABEL: Record<AnyCategory, string> = {
  rebalancing: "Keep my LP position in range",
  grid: "Trade a range automatically",
  yield: "Move my capital to better yield",
  health: "Stop my loan being liquidated",
  trading: "General on-chain trading",
  research: "Research and analysis",
  payments: "Payments and settlement",
  social: "Social and community",
  infra: "Agent infrastructure",
};

export const JUDGED: JudgedCategory[] = ["rebalancing", "grid", "yield", "health"];
export function isJudged(c: string | null | undefined): c is JudgedCategory {
  return !!c && (JUDGED as string[]).includes(c);
}
