/**
 * Grading a task run against a fact read from chain.
 *
 * The Agent Advantage Report needs an outcome per run, and "did it look reasonable"
 * is not an outcome. These questions are chosen so the right answer exists
 * independently: the best Venus supply APR is derivable from `supplyRatePerBlock`
 * on every market, so an agent's reply can be checked rather than admired.
 *
 * WHY THE GRADING IS DELIBERATELY UNGENEROUS.
 *
 * We run these tasks, and we publish the result, which makes us an interested
 * party. The only defence is that the grader cannot be argued into a better mark:
 * a reply is `succeeded` when it contains a number matching the chain within
 * tolerance, `partial` when it answered but produced nothing checkable, and
 * `failed` when it did not usefully answer. Prose that sounds authoritative and
 * contains no number is `partial`, however fluent.
 *
 * This is also why tolerance is explicit and wide-ish rather than hidden. Rates
 * move between the two arms, and an agent reading a block earlier than us is not
 * wrong. Being loose about drift while being strict about the presence of a
 * checkable answer puts the strictness where it belongs.
 *
 * NUMBER EXTRACTION IS THE FRAGILE PART, so it is separated and tested. An agent
 * may reply "5.09%", "5.09 percent", "APY of 0.0509", or bury the figure in a
 * sentence with unrelated numbers such as a block height. Matching ANY extracted
 * number against the truth is the honest rule: requiring the first, or the largest,
 * would fail correct answers for formatting reasons.
 */

export type RunOutcome = "succeeded" | "partial" | "failed" | "disputed";

export type Grade = {
  outcome: RunOutcome;
  /** The extracted number that matched, when one did. */
  matched: number | null;
  /** Every number found, so a reader can see what the grader had to work with. */
  found: number[];
  /** Why this mark was given, in words, for the attestation record. */
  note: string;
};

/**
 * Pull candidate numbers out of free text.
 *
 * Handles thousands separators and trailing percent signs. Deliberately does NOT
 * try to understand units: a percentage and a ratio for the same rate differ by
 * 100x, so both forms are offered to the comparison rather than guessed at here.
 */
export function extractNumbers(text: string): number[] {
  if (!text) return [];
  const out: number[] = [];
  /**
   * One pattern, greedy on the leading digits.
   *
   * An earlier version led with `\d{1,3}(?:,\d{3})*` to handle thousands
   * separators, which chopped an ungrouped integer into three-digit pieces:
   * a block height of 47120933 came out as 471, 209 and 33. That was not merely
   * untidy - 471 divided by 100 is 4.71, which then scored as a correct answer for
   * a 5.09% rate. A grading false positive manufactured entirely by the tokeniser.
   *
   * `\d+` first consumes the whole run of digits, and the optional comma groups
   * still match "1,234,567" because the first group is absorbed by `\d+`.
   */
  const re = /-?\d+(?:,\d{3})*(?:\.\d+)?/g;
  for (const m of text.matchAll(re)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Does any number in the reply match the truth?
 *
 * Accepts the ratio form as well as the percentage: an agent reporting 0.0509 for a
 * 5.09% rate has answered correctly in different units, and marking that wrong
 * would be a grading artefact rather than a finding.
 *
 * Only that direction is accepted. Also allowing n/100 would mean a stray 471
 * anywhere in the text scored a 5.09% answer, which tripled the false-pass surface
 * to cover a convention nobody actually uses - nobody writes 509 to mean 5.09%.
 */
export function gradeNumericAnswer(
  reply: string,
  truth: number,
  tolerancePct = 15,
): Grade {
  const trimmed = (reply ?? "").trim();
  if (!trimmed) {
    return { outcome: "failed", matched: null, found: [], note: "no reply body" };
  }

  const found = extractNumbers(trimmed);
  if (!found.length) {
    return {
      outcome: "partial",
      matched: null,
      found,
      note: "replied but contained no number, so nothing could be checked against chain state",
    };
  }

  const within = (a: number, b: number) => {
    if (b === 0) return a === 0;
    return (Math.abs(a - b) / Math.abs(b)) * 100 <= tolerancePct;
  };

  for (const n of found) {
    if (within(n, truth) || within(n * 100, truth)) {
      return {
        outcome: "succeeded",
        matched: n,
        found,
        note: `reply contained ${n}, within ${tolerancePct}% of the chain value ${truth.toFixed(4)}`,
      };
    }
  }

  return {
    outcome: "partial",
    matched: null,
    found,
    note:
      `replied with ${found.slice(0, 6).join(", ")} but none is within ${tolerancePct}% ` +
      `of the chain value ${truth.toFixed(4)}`,
  };
}

/**
 * Protocol scaffolding, never content.
 *
 * `jsonrpc: "2.0"` put a bare 2 into the extracted numbers, and 2 is within 15% of a
 * health factor of 1.7824. An agent that replied with a JSON-RPC ERROR was therefore
 * graded as having correctly reported the ratio. A false pass manufactured entirely
 * from the envelope.
 */
const PROTOCOL_KEYS = new Set(["jsonrpc", "id", "messageId", "kind", "role", "protocolVersion"]);

/**
 * Is this a JSON-RPC error rather than an answer?
 *
 * Checked before grading, because an error body is not a reply that happens to be
 * wrong - it is the agent declining to answer, and grading its prose for stray digits
 * is how "unknown skill: None negotiate notify_funded" became a correct health factor.
 */
export function rpcErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (!err) return null;
  if (typeof err === "string") return err.slice(0, 200);
  if (typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown };
    const code = typeof e.code === "number" ? `${e.code}: ` : "";
    const msg = typeof e.message === "string" ? e.message : JSON.stringify(err);
    return `${code}${msg}`.slice(0, 200);
  }
  return "unspecified error";
}

/**
 * Extract whatever text an agent actually sent back.
 *
 * A2A and MCP both nest the useful content, and implementations differ in where
 * they put it. Returning the raw JSON when no known shape matches is deliberate:
 * the attestation should hold what the agent said, and a null would lose evidence
 * that a human reviewer could still read.
 */
export function replyText(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;

  const seen = new Set<unknown>();
  const parts: string[] = [];

  const walk = (v: unknown, depth: number) => {
    if (v == null || depth > 6) return;
    if (typeof v === "string") {
      if (v.trim()) parts.push(v.trim());
      return;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      parts.push(String(v));
      return;
    }
    if (typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);

    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }

    const o = v as Record<string, unknown>;
    // Prefer the fields A2A and MCP actually carry content in.
    for (const key of ["text", "content", "parts", "message", "result", "output", "data"]) {
      if (key in o) walk(o[key], depth + 1);
    }
    // Nothing recognised: fall back to every value EXCEPT protocol scaffolding, so
    // the envelope cannot contribute digits that get graded as an answer.
    if (!parts.length) {
      for (const [k, val] of Object.entries(o)) {
        if (PROTOCOL_KEYS.has(k)) continue;
        walk(val, depth + 1);
      }
    }
  };

  walk(body, 0);
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined) return joined;

  /**
   * Last resort: the raw JSON minus the scaffolding. Stringifying the whole object
   * reintroduced "jsonrpc":"2.0" and with it the stray 2.
   */
  if (typeof body === "object" && !Array.isArray(body)) {
    const stripped = Object.fromEntries(
      Object.entries(body as Record<string, unknown>).filter(([k]) => !PROTOCOL_KEYS.has(k)),
    );
    return JSON.stringify(stripped).slice(0, 2000);
  }
  return JSON.stringify(body).slice(0, 2000);
}
