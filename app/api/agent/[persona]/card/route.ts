/**
 * A2A Agent Cards for the GEBO reference personas (yield, grid, rebalance).
 *
 * health has its own static pair; this dynamic route covers the other three so
 * there is one card shape, not four diverging ones. The advertised endpoint is
 * derived from the request host - hardcoding a host is how a card ends up
 * naming an endpoint that does not run on it.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PERSONAS: Record<string, {
  name: string;
  description: string;
  skillId: string;
  skillName: string;
  skillDescription: string;
  tags: string[];
  examples: string[];
}> = {
  yield: {
    name: "GEBO Yield Router Reference",
    description:
      "Ranks live Venus supply markets by measured APR and reports where idle capital earns most right now, " +
      "with lendable liquidity attached and broken-rate artifacts named rather than ranked. Operated by GEBO: " +
      "excluded from rankings; any track record is graded by APEX's EvaluatorRouter.",
    skillId: "venus-best-apr",
    skillName: "Best Venus supply APR",
    skillDescription:
      "Reads every listed Venus market's supplyRatePerBlock and getCash at one block, annualises simply, " +
      "filters markets under $50k lendable liquidity, and returns the ranking with its exclusions.",
    tags: ["yield", "venus", "apr", "lending", "bnb"],
    examples: ["Where should idle USDT earn the most on Venus right now?"],
  },
  grid: {
    name: "GEBO Grid Runner Reference",
    description:
      "Reports the deepest eligible PancakeSwap V3 pool for grid trading - current tick, and a symmetric " +
      "grid bound suggestion computed from it. Market state plus arithmetic, never orders. Operated by GEBO.",
    skillId: "v3-grid-state",
    skillName: "V3 grid market state",
    skillDescription:
      "Slot0 of the deepest eligible pool by TVL in the grid category, with tick-derived price bounds for " +
      "a symmetric +/-3% grid.",
    tags: ["grid", "pancakeswap", "v3", "trading", "bnb"],
    examples: ["What are good grid bounds for the deepest WBNB/USDT-style pool right now?"],
  },
  rebalance: {
    name: "GEBO RangeKeeper Reference",
    description:
      "Reports current V3 pool state for concentrated-liquidity rebalancing: the active tick, and what a " +
      "spot-centred range looks like. Reads-only; states the rebalance condition without seeing your NFT. Operated by GEBO.",
    skillId: "v3-range-state",
    skillName: "V3 range state check",
    skillDescription:
      "Slot0 of the deepest eligible pool by TVL in the rebalancing category, with a spot-centred +/-10% " +
      "range and the one-sided-capital condition explained.",
    tags: ["rebalancing", "pancakeswap", "v3", "lp", "bnb"],
    examples: ["Does the deepest V3 LP pool need a re-range right now?"],
  },
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ persona: string }> },
) {
  const { persona } = await params;
  const p = PERSONAS[persona];
  if (!p) {
    return NextResponse.json({ error: `unknown persona "${persona}"` }, { status: 404 });
  }
  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}`;

  return NextResponse.json(
    {
      protocolVersion: "0.3.0",
      name: p.name,
      description: p.description,
      version: "1.0.0",
      url: `${base}/api/agent/${persona}/a2a`,
      preferredTransport: "JSONRPC",
      provider: { organization: "GEBO", url: base },
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["text/plain", "application/json"],
      skills: [
        {
          id: p.skillId,
          name: p.skillName,
          description: p.skillDescription,
          tags: p.tags,
          examples: p.examples,
          inputModes: ["text/plain", "application/json"],
          outputModes: ["text/plain", "application/json"],
        },
      ],
      "x-gebo": {
        operator: "gebo",
        excludedFromRanking: true,
        reason: "operated by the registry; ranking our own listing would make grader and solver the same party",
        readsOnly: true,
        note: "This agent holds no keys and moves no funds. It reads chain state and returns figures with their denominators.",
      },
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
