/**
 * A2A endpoint for the reference health-factor agent.
 *
 * Speaks JSON-RPC message/send, the method the registry's own probe and task harness
 * send. That is deliberate: an agent we operate must be callable by the same client
 * that calls everyone else, or we would be grading others against a bar we do not
 * meet ourselves.
 *
 * READS ONLY. No keys, no transactions, no funds. It answers a question about public
 * chain state, which is the entire risk surface - worth stating because /authority
 * exists to ask what an agent can do to a wallet, and the answer here is nothing.
 *
 * FAILURE IS REPORTED AS FAILURE. If the address is missing or malformed, or the RPC
 * read fails, it says so. It never returns a plausible-looking number it did not
 * compute, which is the failure mode this whole project was built to expose.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { healthFactorFor, summarise } from "@/lib/venus";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/** JSON-RPC error, in the shape A2A clients expect. */
function rpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

/**
 * Pull an address out of whatever the client sent.
 *
 * A2A carries text parts, data parts, or both, and implementations differ. Accepting
 * all three is not laxity: the registry's own harness sends a text part, and an agent
 * that only accepted structured input would be unusable by the majority of clients -
 * exactly the mismatch that made five verified agents unhireable.
 */
function extractAddress(params: unknown): Address | null {
  const seen = new Set<unknown>();
  let found: Address | null = null;

  const walk = (v: unknown, depth: number) => {
    if (found || v == null || depth > 6) return;
    if (typeof v === "string") {
      const m = v.match(/0x[a-fA-F0-9]{40}/);
      if (m && isAddress(m[0])) found = m[0] as Address;
      return;
    }
    if (typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const i of v) walk(i, depth + 1); return; }
    for (const val of Object.values(v as Record<string, unknown>)) walk(val, depth + 1);
  };

  walk(params, 0);
  return found;
}

export async function POST(request: Request) {
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: body is not JSON");
  }

  const id = body.id ?? null;

  if (body.method !== "message/send" && body.method !== "message/stream") {
    return rpcError(id, -32601, `Method not found: ${body.method ?? "(none)"}. This agent accepts message/send.`);
  }

  const address = extractAddress(body.params);
  if (!address) {
    return rpcError(
      id,
      -32602,
      "No BNB Chain address found in the message. Send one as a text part, " +
        'for example "health factor for 0xAB12...", or as a data part {"address":"0x..."}.',
    );
  }

  const started = Date.now();
  try {
    const report = await healthFactorFor(address);
    const text = summarise(report);

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        kind: "message",
        role: "agent",
        messageId: `gebo-health-${Date.now()}`,
        parts: [
          { kind: "text", text },
          {
            /**
             * Structured alongside the prose, so a machine client does not have to
             * parse English and a human does not have to read JSON. The numbers that
             * produced the ratio travel with it, per design law L2.
             */
            kind: "data",
            data: {
              account: report.account,
              blockNumber: report.blockNumber.toString(),
              healthFactor: report.healthFactor,
              verdict: report.verdict,
              borrowingPowerUsd: report.borrowingPowerUsd,
              totalBorrowedUsd: report.totalBorrowedUsd,
              totalSuppliedUsd: report.totalSuppliedUsd,
              liquidityUsd: report.liquidityUsd,
              shortfallUsd: report.shortfallUsd,
              marketsEntered: report.positions.length,
              positions: report.positions.map((p) => ({
                market: p.symbol,
                suppliedUsd: p.suppliedUsd,
                borrowedUsd: p.borrowedUsd,
                collateralFactor: p.collateralFactor,
              })),
              qualifiers: {
                source: "Venus Comptroller and per-market getAccountSnapshot, read at the block above",
                liquidatableAtOrBelow: 1,
                dustDebtFloorUsd: 0.01,
                basis:
                  "getAssetsIn, so vTokens held without entering a market are excluded: they grant no borrowing power",
                validation:
                  "exact against Venus getAccountLiquidity on zero-debt positions; 0.0825% on a live borrowing position",
              },
              computedInMs: Date.now() - started,
            },
          },
        ],
      },
    });
  } catch (err: unknown) {
    const message = String((err as Error)?.message ?? err).slice(0, 200);
    // An RPC failure is a failure to measure. Never substitute a number.
    return rpcError(id, -32000, `Could not read Venus state for ${address}: ${message}`);
  }
}

/** A GET here is a common mistake; point it at the card rather than 405-ing silently. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json(
    {
      error: "This is the A2A JSON-RPC endpoint. POST a message/send request.",
      card: `${url.protocol}//${url.host}/api/agent/health/card`,
      example: {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { role: "user", messageId: "1", parts: [{ kind: "text", text: "health factor for 0xAB12DE9c36DaD3d05f2D5F791b31669338C1F055" }] } },
      },
    },
    { status: 405 },
  );
}
