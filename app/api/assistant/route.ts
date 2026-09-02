/**
 * GEBO product assistant, powered by the Gemini Interactions API.
 *
 * READ-ONLY BY DESIGN. The tools it can call read the same database the UI
 * reads; there is no tool that signs, sends, spends, revokes or writes. When a
 * user wants to hire or authorise an agent, the assistant navigates them to
 * the hire flow - where nothing is signed without an explicit human approval
 * in their own wallet. An assistant that could act on a wallet would violate
 * the same invariant as taking a fee on completion: the guide must never be
 * the hand on the switch.
 *
 * Conversation state uses previous_interaction_id (interactions are stored
 * server-side by default), so the client ships only the newest message plus
 * the last interaction id - not the whole transcript.
 */
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { TOOL_DECLARATIONS, executeAssistantTool } from "@/lib/assistant-tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

const SYSTEM_PROMPT = [
  "You are the GEBO assistant on gebo-bsc.vercel.app, the verification-first agent registry for BNB Smart Chain. You help visitors find, understand and compare on-chain AI agents.",
  "",
  "Hard rules:",
  "- You are read-only. You cannot sign, send, approve, spend, revoke or change anything, and you must never claim to. If a user wants to hire or authorise an agent, point them to the agent's hire page (/a/{tokenId}/hire) and say nothing is signed until they explicitly approve in their own wallet.",
  "- Never invent numbers. Any figure about agents, categories, uptime or the registry funnel must come from your tools. If a tool errors or returns nothing, say you could not read it.",
  "- There are no star ratings, scores or popularity rankings anywhere in GEBO, by design: unanchored ratings carry no information (measured correlation with real usage is roughly zero) and unfiltered aggregation is Sybil-farmable. The one permitted review form is a verified comment anchored to a completed escrow job - see product knowledge below. Compare agents on measured evidence (uptime, latency, task attestations, verified reviews).",
  "",
  "Product knowledge:",
  "- Trust states: VERIFIED = completed an A2A or MCP protocol handshake; LISTED = responded but did not speak a protocol; DORMANT = unreachable at our last probe; SHADOWED = fatal registration defect, uncallable.",
  "- The four core job categories: rebalancing (keep an LP position in range, PancakeSwap V3), grid (trade a range automatically), yield (route capital to the best sustainable rate, Venus), health (stop a loan being liquidated, Venus). Five more exist: trading, research, payments, social, infra.",
  "- Probing runs from a single region. A down agent is unreachable from our probe, not necessarily down everywhere. Uptime percentages only render after 20 observations.",
  "- Registry funnel live numbers come from get_registry_stats. Approximate shape: about 305,000 identities registered, only a few thousand callable - discovery is not the hard part, verification is.",
  "- Verified reviews: free-text comments from wallets that completed an APEX (ERC-8183) escrow job as the agent's client. The gate is verified on chain at write time - job status Completed, client = signer, provider = the agent - so a fake review costs a real completed hire (about 7 transactions, gas, and a dispute window) rather than 0.01 $U. Comments are evidence, never scores, and never affect ordering. An empty review section means no completed hire exists yet, not that the agent is bad. Users leave them from the agent card's Track record tab; programmatic clients (including agents) POST to /api/reviews with a wallet signature. Read them with get_verified_reviews.",
  "",
  "Pages you can link (relative): / (home), /c/{slug} (category), /a/{tokenId} (agent card), /a/{tokenId}/hire (choose scope, simulate, then hire on chain with your own wallet), /search, /live (liveness ledger), /authority (what an agent could do to a wallet), /compare (counterfactual Agent Advantage Report), /methodology.",
  "",
  "Style: concise (under 150 words unless asked for more), plain English first, deeper technical detail on request. Use markdown links for anything you reference. If you do not know something, say so.",
].join("\n");

type AnyStep = { type: string; [k: string]: unknown };

function extractText(steps: AnyStep[] | undefined): string {
  if (!steps) return "";
  const texts: string[] = [];
  // Take the trailing run of model_output steps so tool-call interleavings
  // from earlier rounds do not duplicate content.
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type !== "model_output") break;
    const content = (s as { content?: { type?: string; text?: string }[] }).content ?? [];
    for (const c of content) if (c.type === "text" && c.text) texts.unshift(c.text);
  }
  return texts.join("\n").trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Assistant is not configured (missing GEMINI_API_KEY)." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { text?: unknown; interactionId?: unknown }
    | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 2000) : "";
  const prevId =
    typeof body?.interactionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.interactionId)
      ? body.interactionId
      : null;

  if (!text) {
    return NextResponse.json({ ok: false, error: "Empty message." }, { status: 400 });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    let interaction = await ai.interactions.create({
      model: MODEL,
      system_instruction: SYSTEM_PROMPT,
      tools: TOOL_DECLARATIONS as unknown as never[],
      input: text,
      ...(prevId ? { previous_interaction_id: prevId } : {}),
    });

    const toolCalls: { name: string; args: unknown }[] = [];

    // Tool rounds: the model returns function_call steps; we execute and send
    // function_result steps back, chained via previous_interaction_id.
    for (let round = 0; round < 4; round++) {
      if (interaction.status === "failed" || interaction.status === "cancelled") {
        return NextResponse.json(
          { ok: false, error: "The assistant could not complete this request." },
          { status: 502 },
        );
      }

      const steps = (interaction.steps ?? []) as unknown as AnyStep[];
      const calls = steps.filter((s) => s.type === "function_call") as unknown as {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }[];

      if (calls.length === 0) break;

      const results = [];
      for (const call of calls) {
        const result = await executeAssistantTool(call.name, call.arguments ?? {});
        toolCalls.push({ name: call.name, args: call.arguments });
        results.push({
          type: "function_result" as const,
          call_id: call.id,
          name: call.name,
          result,
        });
      }

      interaction = await ai.interactions.create({
        model: MODEL,
        system_instruction: SYSTEM_PROMPT,
        tools: TOOL_DECLARATIONS as unknown as never[],
        previous_interaction_id: interaction.id,
        input: results as never,
      });
    }

    const reply = extractText(interaction.steps as unknown as AnyStep[]);
    if (!reply) {
      return NextResponse.json(
        { ok: false, error: "The assistant returned no answer. Try rephrasing." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      reply,
      interactionId: interaction.id,
      toolCalls,
    });
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 200);
    return NextResponse.json(
      { ok: false, error: `Assistant error: ${message}` },
      { status: 502 },
    );
  }
}
