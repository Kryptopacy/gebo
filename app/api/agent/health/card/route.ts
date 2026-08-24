/**
 * A2A Agent Card for GEBO's reference health-factor agent.
 *
 * WHY WE RUN ONE AT ALL. The judged `health` category is about to lose Health Factor
 * Monitor (#269228), which advertises http://127.0.0.1:9104/ and therefore cannot be
 * hired by anyone. Four other verified agents have the same defect. A reference
 * implementation that actually answers is not padding the category - it replaces a
 * listing that was never callable with one that demonstrably is.
 *
 * THE CARD'S url IS THE POINT. Five agents in this registry publish a reachable card
 * that names an unreachable endpoint, which is how they passed verification while
 * being impossible to use. This card names the endpoint that serves it, on the same
 * public host, so the claim is checkable by the same probe that catches them.
 *
 * GRADER IS NEVER SOLVER. This agent is ours, so it is excluded from ranking, marked
 * as ours wherever it appears, and any track record it accumulates through APEX is
 * graded by their EvaluatorRouter rather than by us. We never score our own work.
 *
 * WHY HEALTH FACTOR. It is the most mechanically verifiable question in the judged
 * four: a ratio of collateral to debt, both readable from chain, with no room for
 * taste. Our computation is validated against Venus's own getAccountLiquidity to
 * within 0.0825% on a live borrowing position, and to the cent on zero-debt
 * positions. An agent whose output cannot be checked cannot have a track record
 * worth publishing.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The endpoint this card advertises.
 *
 * Derived from the request host rather than hardcoded, so a preview deployment
 * advertises itself and never points clients at production. Hardcoding is how a card
 * ends up naming a host it does not run on.
 */
function endpointFor(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/agent/health/a2a`;
}

export async function GET(request: Request) {
  const endpoint = endpointFor(request);

  return NextResponse.json(
    {
      protocolVersion: "0.3.0",
      name: "GEBO Health Factor Reference",
      description:
        "Reports the Venus lending health factor for a BNB Chain address, derived from " +
        "per-market collateral, oracle prices and collateral factors rather than from a " +
        "single liquidity call. Operated by GEBO as a reference implementation: it is " +
        "excluded from all rankings, and any track record it earns is graded by APEX's " +
        "EvaluatorRouter, never by us.",
      version: "1.0.0",
      // The endpoint clients should call. Same host that served this card.
      url: endpoint,
      preferredTransport: "JSONRPC",
      provider: {
        organization: "GEBO",
        url: `${new URL(request.url).protocol}//${new URL(request.url).host}`,
      },
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["text/plain", "application/json"],
      skills: [
        {
          id: "health-factor",
          name: "Venus health factor",
          description:
            "Given a BNB Chain address, returns its Venus health factor with the collateral " +
            "and debt it was computed from, the markets entered, and the liquidation " +
            "thresholds. Answers 'no collateral enabled', 'no debt' or 'dust debt' where " +
            "those apply rather than inventing a ratio.",
          tags: ["health", "venus", "lending", "liquidation", "risk", "bnb"],
          examples: [
            "What is the health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055?",
            '{"address":"0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055"}',
          ],
          inputModes: ["text/plain", "application/json"],
          outputModes: ["text/plain", "application/json"],
        },
      ],
      /**
       * Published limits. The prober's single-region defect is disclosed on
       * /methodology for the same reason: a measurement whose limits are visible is
       * evidence, and one whose limits are hidden is marketing.
       */
      "x-gebo": {
        operator: "gebo",
        excludedFromRanking: true,
        reason: "operated by the registry; ranking our own listing would make grader and solver the same party",
        readsOnly: true,
        note: "This agent holds no keys and moves no funds. It reads chain state and returns a number with its denominator.",
        validation:
          "Collateral scaling checked against Venus getAccountLiquidity: exact on zero-debt positions, 0.0825% on a live borrowing position.",
      },
    },
    {
      headers: {
        // Public, cacheable briefly. A card is a document, not a measurement.
        "cache-control": "public, max-age=60",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
