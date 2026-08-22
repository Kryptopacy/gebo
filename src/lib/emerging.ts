/**
 * Emerging-capability detection.
 *
 * Nine hand-written rule sets classify capability. That is honest for today's
 * corpus, where the four judged categories are almost unserved, but it cannot be a
 * resting state: BNB Chain will produce capabilities nobody has named, and a
 * product claiming to be the front door for every agent on the chain must notice.
 *
 * WHY THIS NEVER AUTO-CREATES A CATEGORY.
 *
 * Measured, not assumed. Run against the live corpus, term frequency nominated
 * `unibase` on 17 verified texts - an operator, not a job - plus `swan` and
 * `black` from branded mints called "The Giga Swan" and "Black Swan", and `not`,
 * a function word. Four candidates cleared the bar and all four were noise. The
 * most common terms overall are `bsc`, `defi` and `agent`: venue and buzzword.
 * An automatic taxonomy would spawn a `defi` category holding thousands of
 * unrelated agents, which is worse than leaving them unclassified because it
 * looks authoritative. So this produces candidates with their evidence, and a
 * person decides.
 *
 * NOMINATION REQUIRES A DECLARED SKILL, STRIPPED OF ITS OWN TITLE.
 *
 * The three noise families above all entered through NAMES. Branding lives in
 * names; capability lives in the A2A card's skills array, which is the agent
 * describing its own job in its own machine-readable words - the same hierarchy
 * the classifier already applies, weighting skills 1.0 against a name's 0.5.
 *
 * That alone was not enough, and the corpus showed why. One operator publishes a
 * skills array synthesised from the listing itself:
 *
 *   name   "The White Swan by Unibase"
 *   skills ["The White Swan by Unibase - the_white_swan_by_unibase - Black Swan
 *            does not represent the moment everything changes."]
 *
 * The skill is the name, plus the slugified name, plus the description. It is a
 * restatement, not a declaration, and it carried `unibase` and `swan` straight
 * back in. So the listing's own title and slug are removed from the skill text
 * before anything is counted: a skill that only repeats the title states no
 * capability. Several of these agents have nothing left afterwards, which is the
 * correct reading - they are token launches registered as identities, and they
 * declare no capability at all.
 *
 * A CANDIDATE MUST SPAN MORE THAN ONE OPERATOR.
 *
 * The decisive filter, and the most general one. All 16 `unibase` texts come from
 * a single operator mass-minting memecoin listings. A term confined to one
 * operator is that operator's product name or house style; a capability that two
 * independent parties describe in the same words is an ecosystem capability. This
 * is what a category means, so it is what the detector requires.
 *
 * The cost is recall: a genuinely new capability that exactly one operator has
 * built goes unnoticed until a second arrives. That trade is deliberate. A
 * detector that cries wolf is a detector nobody reads, and precision is what makes
 * it worth scheduling.
 *
 * THE JUDGED FOUR ARE CLOSED. A candidate may only ever become an adjacent
 * category. Promoting detected behaviour into a judged tier is the same inflation
 * that narrowing the grid and yield rules removed.
 */
import { RULE_VOCABULARY } from "./classify";

export type EmergingInput = {
  name: string | null;
  description: string | null;
  skills: string[] | null;
  trustState: string;
  /** Operator domain, when known. Used to suppress brand tokens. */
  operatorDomain: string | null;
  /**
   * Which operator published this. The single most important field here: a term
   * confined to one operator is branding, not a capability.
   */
  operatorKey: string | null;
};

export type Candidate = {
  term: string;
  /** Distinct skills texts, never agent count. See the fingerprint note below. */
  distinctTexts: number;
  verifiedTexts: number;
  /** Independent operators using the term. Below two, it is one house's word. */
  distinctOperators: number;
  examples: string[];
};

export type EmergingResult = {
  /** Rows carrying a skills array, the only ones that can nominate. */
  examined: number;
  /**
   * Rows whose skills text was nothing but the listing's own title. A finding in
   * its own right: these are registrations, not agents that declare a capability.
   */
  titleOnly: number;
  /** After collapsing agents that publish identical skills. */
  distinctTexts: number;
  candidates: Candidate[];
  /** Terms held back, with the reason, so the filtering is auditable. */
  suppressed: { term: string; reason: string }[];
};

/**
 * English function words and corpus filler.
 *
 * Needed because a length test is not a stopword list: the previous filter
 * rejected terms of two characters or fewer, so `not` was nominated as a
 * candidate category on three verified texts. Terms here are also unlikely to
 * ever appear as a skill name, so this mostly guards the description path.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "this", "that", "from", "not",
  "are", "was", "will", "can", "has", "have", "had", "its", "it's", "any",
  "all", "get", "set", "use", "using", "via", "per", "out", "off", "own",
  "new", "old", "one", "two", "how", "who", "why", "when", "what", "which",
  "into", "onto", "over", "under", "then", "than", "also", "but", "not",
  "our", "their", "them", "they", "his", "her", "him", "she", "who", "whom",
  "based", "powered", "enabled", "ready", "simple", "easy", "fast", "best",
  "more", "most", "less", "very", "just", "only", "even", "still", "yet",
]);

/**
 * Venue and buzzword noise: common in this corpus and uninformative about what
 * an agent does. Kept separate from STOPWORDS because these are domain terms
 * rather than grammar, and the distinction matters when reviewing the filter.
 */
const VENUE_NOISE = new Set([
  "bsc", "bnb", "chain", "defi", "agent", "agents", "ai", "onchain", "web3",
  "crypto", "token", "tokens", "protocol", "network", "smart", "contract",
  "blockchain", "autonomous", "automated", "bot", "assistant", "live", "real",
  "time", "data", "api", "http", "https", "json", "rpc", "test", "testing",
  "demo", "example", "sample", "hello", "world", "mainnet", "testnet",
  "wallet", "address", "user", "users", "service", "platform", "tool", "tools",
  "skill", "skills", "task", "tasks", "action", "actions", "query", "request",
]);

/**
 * Collapse everything that is not a letter or a digit to a space.
 *
 * An explicit punctuation class missed the em dash these listings use as their
 * field separator, so "Giga Swan by Unibase - giga_swan_by_unibase" left a stray
 * dash behind after title stripping and the text tested as non-empty. Inverting
 * the test - keep letters and numbers, discard the rest - cannot miss a separator
 * nobody thought of.
 *
 * Unicode-aware so that a Japanese agent name survives as letters rather than
 * being erased into an empty string.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Remove the listing's own title from its skill text.
 *
 * One operator synthesises skills as "<name> - <slug> - <description>", so the
 * title arrives three times over and its words look like declared capability.
 * What remains is whatever the agent said that was not already its own title.
 *
 * Returns an empty string when nothing remains, which is a meaningful result: the
 * agent declares no capability beyond restating what it is called.
 *
 * MATCHES WHOLE TOKENS, NOT SUBSTRINGS. A naked `includes` check was destructive
 * on this corpus, where agent names really are things like "a", "ala" and
 * "premium": an agent named "a" had every letter `a` deleted from its own
 * description, and "ala" would gut the word "escalate". Token-sequence removal is
 * also Unicode-safe, which a word-boundary regex is not.
 */
export function stripTitleEcho(skillText: string, name: string | null): string {
  const text = normalise(skillText);
  if (!name) return text;

  const title = normalise(name).split(" ").filter(Boolean);
  if (!title.length) return text;

  const tokens = text.split(" ").filter(Boolean);
  const kept: string[] = [];

  for (let i = 0; i < tokens.length; ) {
    let matches = true;
    for (let j = 0; j < title.length; j++) {
      if (tokens[i + j] !== title[j]) { matches = false; break; }
    }
    if (matches) {
      i += title.length;
    } else {
      kept.push(tokens[i]!);
      i++;
    }
  }

  return kept.join(" ").trim();
}

/**
 * Is this token already covered by a classification rule?
 *
 * Prefix-matched for entries of four characters or more, because the rules match
 * phrases as substrings and therefore behave as stems: `rebalanc` is what the
 * rule contains, while `rebalancing` is what the corpus writes. Exact matching
 * let the inflected form through, so the detector nominated a capability that was
 * already implemented - the precise failure the derived vocabulary was meant to
 * prevent.
 *
 * Short entries stay exact. Prefix-matching `apr` or `ltv` would swallow
 * unrelated words like "april" for no benefit.
 */
function coveredByRule(token: string): boolean {
  if (RULE_VOCABULARY.has(token)) return true;
  for (const entry of RULE_VOCABULARY) {
    if (entry.length >= 4 && token.startsWith(entry)) return true;
  }
  return false;
}

/**
 * Detect terms the rules do not cover.
 *
 * Pure, so it is testable without a database and cannot behave differently in the
 * scheduled job than in the script an operator runs by hand. The previous version
 * lived inside a script and duplicated the rule vocabulary in a hand-maintained
 * list, which meant implementing a capability did not stop the detector nominating
 * it.
 */
export function detectEmerging(
  rows: EmergingInput[],
  opts: { minDistinctTexts?: number; minOperators?: number; maxCandidates?: number } = {},
): EmergingResult {
  const minDistinct = opts.minDistinctTexts ?? 3;
  const minOperators = opts.minOperators ?? 2;
  const maxCandidates = opts.maxCandidates ?? 25;

  /**
   * Operator brand tokens, from the registrable domain.
   *
   * Retained as a second line of defence even though nomination now requires a
   * skills hit. It is not sufficient on its own: `unibase` was nominated 17 times
   * precisely because those agents carry no operator domain, so there was nothing
   * to derive a brand token from.
   */
  const brandTokens = new Set<string>();
  for (const r of rows) {
    if (!r.operatorDomain) continue;
    for (const part of normalise(r.operatorDomain).split(" ")) {
      if (part.length > 2) brandTokens.add(part);
    }
  }

  /**
   * Count DISTINCT skills texts, not agents.
   *
   * Mass-minted agents share one declaration verbatim. Counting agents treated
   * one author writing one sentence as hundreds of independent observations, which
   * is how a poetic description became a candidate category.
   */
  const seen = new Set<string>();
  const freq = new Map<
    string,
    { texts: number; verified: number; operators: Set<string>; examples: Set<string> }
  >();
  const suppressedBy = new Map<string, string>();
  let examined = 0;
  let titleOnly = 0;

  for (const r of rows) {
    const skills = (r.skills ?? []).filter((s) => s && s.trim());
    if (!skills.length) continue;
    examined++;

    const stripped = stripTitleEcho(skills.join(" "), r.name);
    if (!stripped) { titleOnly++; continue; }

    if (seen.has(stripped)) continue;
    seen.add(stripped);

    const terms = new Set(stripped.split(" ").filter(Boolean));
    for (const t of terms) {
      if (t.length <= 2 || /^\d+$/.test(t)) continue;
      if (coveredByRule(t)) { suppressedBy.set(t, "already covered by a rule"); continue; }
      if (STOPWORDS.has(t)) { suppressedBy.set(t, "function word"); continue; }
      if (VENUE_NOISE.has(t)) { suppressedBy.set(t, "venue or buzzword noise"); continue; }
      if (brandTokens.has(t)) { suppressedBy.set(t, "operator brand token"); continue; }

      const e = freq.get(t) ?? {
        texts: 0, verified: 0, operators: new Set<string>(), examples: new Set<string>(),
      };
      e.texts++;
      if (r.trustState === "VERIFIED") e.verified++;
      // An unknown operator counts as its own, so a term cannot clear the
      // multi-operator bar on rows whose provenance we cannot establish.
      e.operators.add(r.operatorKey ?? "unknown");
      if (e.examples.size < 3 && r.name) e.examples.add(r.name.slice(0, 28));
      freq.set(t, e);
    }
  }

  const candidates: Candidate[] = [];
  for (const [term, e] of freq) {
    if (e.texts < minDistinct) continue;
    if (e.operators.size < minOperators) {
      suppressedBy.set(term, `confined to ${e.operators.size} operator`);
      continue;
    }
    candidates.push({
      term,
      distinctTexts: e.texts,
      verifiedTexts: e.verified,
      distinctOperators: e.operators.size,
      examples: [...e.examples],
    });
  }
  candidates.sort(
    (a, b) =>
      b.distinctOperators - a.distinctOperators ||
      b.verifiedTexts - a.verifiedTexts ||
      b.distinctTexts - a.distinctTexts,
  );

  return {
    examined,
    titleOnly,
    distinctTexts: seen.size,
    candidates: candidates.slice(0, maxCandidates),
    suppressed: [...suppressedBy.entries()].map(([term, reason]) => ({ term, reason })),
  };
}

/**
 * Does a candidate warrant a person's attention?
 *
 * Verified agents only, and more than one of them. An unverified listing has not
 * answered a probe, so its declared capability is a claim about software that may
 * not exist - and inventing a category to describe absent software is the padding
 * this project refuses elsewhere.
 */
export function warrantsReview(c: Candidate): boolean {
  return c.verifiedTexts >= 3 && c.distinctOperators >= 2;
}
