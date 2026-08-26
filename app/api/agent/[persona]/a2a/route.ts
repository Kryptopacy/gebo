/**
 * A2A JSON-RPC endpoints for the GEBO reference personas.
 *
 * Same contract as the health pair: message/send in, a text part plus a data
 * part out, failures as JSON-RPC errors rather than plausible-looking numbers.
 * The persona dispatch is one switch over three read-only answers in
 * src/lib/personas.ts - there is nothing here worth per-persona files.
 */
import { NextResponse } from "next/server";
import { answerYield, answerGrid, answerRebalance } from "@/lib/personas";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function rpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status: 200 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ persona: string }> },
) {
  const { persona } = await params;

  let body: { jsonrpc?: string; id?: unknown; method?: string };
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: body is not JSON");
  }
  const id = body.id ?? null;

  if (body.method !== "message/send" && body.method !== "message/stream") {
    return rpcError(id, -32601, `Method not found: ${body.method ?? "(none)"}. This agent accepts message/send.`);
  }

  const started = Date.now();
  try {
    let answer;
    switch (persona) {
      case "yield": answer = await answerYield(); break;
      case "grid": answer = await answerGrid(); break;
      case "rebalance": answer = await answerRebalance(); break;
      default:
        return NextResponse.json({ error: `unknown persona "${persona}"` }, { status: 404 });
    }
    answer.data.computedInMs = Date.now() - started;

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        kind: "message",
        role: "agent",
        messageId: `gebo-${persona}-${Date.now()}`,
        parts: [
          { kind: "text", text: answer.text },
          { kind: "data", data: answer.data },
        ],
      },
    });
  } catch (err: unknown) {
    const message = String((err as Error)?.message ?? err).slice(0, 200);
    // A failed read is a failure to measure. Never substitute a number.
    return rpcError(id, -32000, `Could not complete the ${persona} task: ${message}`);
  }
}

/** A GET here is a common mistake; point it at the card. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const persona = url.pathname.split("/")[3];
  return NextResponse.json(
    {
      error: "This is the A2A JSON-RPC endpoint. POST a message/send request.",
      card: `${url.protocol}//${url.host}/api/agent/${persona}/card`,
    },
    { status: 405 },
  );
}
