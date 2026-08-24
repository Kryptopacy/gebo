import { describe, it, expect } from "vitest";
import { extractNumbers, gradeNumericAnswer, replyText, rpcErrorMessage } from "../src/lib/task-grade.ts";

/**
 * Task grading.
 *
 * We run these tasks and publish the outcome, which makes us an interested party.
 * These tests are the defence: the grader must not be arguable into a better mark,
 * and fluent prose containing no checkable number must never score as success.
 */

describe("extractNumbers", () => {
  it("finds percentages, decimals and thousands separators", () => {
    expect(extractNumbers("The best supply APR is 5.09% right now")).toContain(5.09);
    expect(extractNumbers("TVL is 1,234,567 USD")).toContain(1234567);
    expect(extractNumbers("ratio 0.0509")).toContain(0.0509);
  });

  it("returns every number, not just the first", () => {
    // An agent may lead with a block height or a market count. Requiring the first
    // number would fail correct answers for formatting reasons alone.
    const found = extractNumbers("At block 47120933, vUSDT supplies at 5.09%");
    expect(found).toContain(47120933);
    expect(found).toContain(5.09);
  });

  it("is empty for text with no numbers", () => {
    expect(extractNumbers("Rates are attractive at the moment.")).toEqual([]);
    expect(extractNumbers("")).toEqual([]);
  });
});

describe("gradeNumericAnswer", () => {
  const truth = 5.09;

  it("passes a reply carrying the right number", () => {
    const g = gradeNumericAnswer("Best supply APR: 5.09%", truth);
    expect(g.outcome).toBe("succeeded");
    expect(g.matched).toBe(5.09);
  });

  it("accepts the ratio form of the same rate", () => {
    // 0.0509 for 5.09% is correct in different units. Marking it wrong would be a
    // grading artefact, not a finding about the agent.
    expect(gradeNumericAnswer("APY 0.0509", truth).outcome).toBe("succeeded");
  });

  it("tolerates drift between the two arms", () => {
    // The agent may read a different block than we do. Rate movement is not error.
    expect(gradeNumericAnswer("about 5.4%", truth).outcome).toBe("succeeded");
  });

  it("marks fluent prose with no number as partial, never as success", () => {
    // The single most important case. An authoritative-sounding answer that cannot
    // be checked is not a correct answer.
    const g = gradeNumericAnswer(
      "Venus currently offers highly competitive stablecoin supply rates across its core markets.",
      truth,
    );
    expect(g.outcome).toBe("partial");
    expect(g.matched).toBeNull();
    expect(g.note).toMatch(/no number/);
  });

  it("marks a confident wrong number as partial, not success", () => {
    const g = gradeNumericAnswer("The best rate is 42%", truth);
    expect(g.outcome).toBe("partial");
    expect(g.note).toMatch(/none is within/);
  });

  it("fails an empty reply", () => {
    expect(gradeNumericAnswer("", truth).outcome).toBe("failed");
    expect(gradeNumericAnswer("   ", truth).outcome).toBe("failed");
  });

  it("does not let an unrelated number in the reply score the point", () => {
    // A block height that happens to sit near the truth would be a false pass, so
    // the tolerance has to be tight enough to exclude obviously unrelated values.
    const g = gradeNumericAnswer("Read at block 47120933.", truth);
    expect(g.outcome).toBe("partial");
  });
});

describe("replyText", () => {
  it("pulls text out of an A2A message shape", () => {
    const body = {
      result: { message: { parts: [{ text: "Best supply APR is 5.09%" }] } },
    };
    expect(replyText(body)).toContain("5.09%");
  });

  it("pulls text out of an MCP tools/call result", () => {
    const body = { result: { content: [{ type: "text", text: "vUSDT 5.09%" }] } };
    expect(replyText(body)).toContain("vUSDT 5.09%");
  });

  it("returns raw JSON rather than nothing when the shape is unknown", () => {
    // Losing the body would destroy evidence a human reviewer could still read.
    const out = replyText({ weird: { nested: 5.09 } });
    expect(out).toMatch(/5\.09/);
  });

  it("survives a cyclic object", () => {
    const a: any = { text: "hello" };
    a.self = a;
    expect(replyText(a)).toContain("hello");
  });

  it("is empty for null", () => {
    expect(replyText(null)).toBe("");
  });

  it("never leaks the protocol envelope into the graded text", () => {
    // The false positive this prevents: "jsonrpc":"2.0" put a bare 2 into the
    // extracted numbers, and 2 is within 15% of a health factor of 1.7824, so an
    // agent that returned an ERROR was graded as reporting the ratio correctly.
    const body = { jsonrpc: "2.0", id: 7, error: { code: -32601, message: "unknown skill" } };
    const text = replyText(body);
    expect(text).not.toMatch(/2\.0/);
    expect(extractNumbers(text)).not.toContain(2);
  });
});

describe("rpcErrorMessage", () => {
  it("identifies a JSON-RPC error so it is never graded as an answer", () => {
    expect(rpcErrorMessage({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "unknown skill" } }))
      .toMatch(/-32601: unknown skill/);
    expect(rpcErrorMessage({ error: "boom" })).toBe("boom");
  });

  it("returns null for a real result", () => {
    expect(rpcErrorMessage({ jsonrpc: "2.0", id: 1, result: { parts: [{ text: "1.78" }] } })).toBeNull();
    expect(rpcErrorMessage(null)).toBeNull();
    expect(rpcErrorMessage("plain text")).toBeNull();
  });
});
