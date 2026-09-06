/**
 * GEBO's MCP server over Streamable HTTP, at /mcp.
 *
 * Stateless by design: no session ids, no server-initiated streams (GET/DELETE
 * answer 405), every request carries everything needed to answer it. That is
 * the shape the Vercel runtime wants and it means clients cannot get wedged on
 * a session that no longer exists.
 *
 * The tool layer is read-only on purpose. Hiring moves money and therefore
 * stays on pages a human can see, with the scope picker and the blast-radius
 * panel in front of it; an MCP tool that could sign would bypass the exact
 * disclosure this project exists to enforce.
 */
import { NextResponse } from "next/server";
import {
  handleMcpPost, MCP_PROTOCOL_VERSION, type McpToolImpl, type McpToolResult,
} from "@/lib/mcp";
import {
  searchAgents, findAgent, trustState, classify, CATEGORIES, CATEGORY_LIST,
  loadOpportunities, loadCensus, agentsByCategory, loadAgents,
  type CategorySlug,
} from "@/lib/data";
import { attestationSummary } from "@/lib/attestations";
import { reviewsFor } from "@/lib/reviews";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-protocol-version, authorization, mcp-session-id",
  "Access-Control-Expose-Headers": "mcp-protocol-version",
};

/**
 * Build a tool result. The structured payload is the same object as the text
 * payload, emitted under structuredContent per MCP 2025-06-18 - generated from
 * one source so the two representations cannot drift apart. Error results
 * carry no structuredContent: their shape is { error }, not the tool's schema.
 */
function text(payload: unknown, isError = false): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : { structuredContent: payload }),
  };
}

function clamp(n: unknown, dflt: number, max: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : dflt;
  return Math.max(1, Math.min(v, max));
}

function siteBase(request: Request): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/$/, "");
  }
  return new URL(request.url).origin;
}

function agentCard(a: Awaited<ReturnType<typeof findAgent>>, base: string) {
  const st = trustState(a!);
  const m = classify(a!);
  return {
    token_id: a!.token_id,
    name: a!.name,
    url: `${base}/a/${a!.token_id}`,
    hire_url: `${base}/a/${a!.token_id}/hire`,
    trust_state: st.state,
    trust_reason: st.reason,
    category: m.category,
    operator_domain: a!.operator?.registrableDomain ?? null,
    endpoints: a!.endpoints,
    liveness: a!.probe
      ? {
          grade: a!.probe.grade,
          http_status: a!.probe.httpStatus,
          rtt_ms: a!.probe.rttMs,
          probed_at: a!.probed_at,
          caveat: "probed on a schedule from one region; cannot distinguish down from unreachable-from-here",
        }
      : null,
    skills: a!.skills,
    self_description: a!.description,
  };
}

/** Tool implementations: the protocol layer in src/lib/mcp.ts stays DB-free. */
function toolsFor(request: Request): Record<string, McpToolImpl> {
  const base = siteBase(request);
  return {
    "search_agents": async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return text({ error: "query is required" }, true);
      const limit = clamp(args.limit, 10, 40);
      const category = typeof args.category === "string" && args.category in CATEGORIES
        ? (args.category as CategorySlug)
        : null;
      let hits = await searchAgents(query, limit);
      if (category) hits = hits.filter((h) => classify(h.agent).category === category);
      return text({
        query,
        result_count: hits.length,
        ordering: "trust state first (VERIFIED, LISTED, DORMANT, SHADOWED), then relevance; never popularity",
        results: hits.map((h) => ({
          token_id: h.agent.token_id,
          name: h.agent.name,
          trust_state: trustState(h.agent).state,
          operator_domain: h.agent.operator?.registrableDomain ?? null,
          why_it_matched: h.why,
          url: `${base}/a/${h.agent.token_id}`,
        })),
      });
    },

    "get_agent": async (args) => {
      const id = String(args.token_id ?? "").trim();
      if (!/^\d+$/.test(id)) return text({ error: "token_id must be a number" }, true);
      const a = await findAgent(id);
      if (!a) {
        return text({
          found: false,
          token_id: id,
          note: "Not in the registry. It may exist on chain and not be indexed yet, or never have existed.",
        });
      }
      const tr = await attestationSummary(id, 56).catch(() => null);
      return text({
        found: true,
        ...agentCard(a, base),
        track_record: tr
          ? {
              attestations: tr.total,
              succeeded: tr.succeeded,
              verified_evidence: tr.verified,
              distinct_attesters: tr.distinctAttesters,
              caveat: "graded by an independent evaluator contract; GEBO never grades agents it lists",
            }
          : { note: "track record could not be read right now - unmeasured, not zero" },
      });
    },

    "list_categories": async () => {
      const agents = await loadAgents(400);
      const byCat = agentsByCategory(agents);
      return text({
        categories: CATEGORY_LIST.map((c) => ({
          slug: c.slug,
          title: c.title,
          job: c.job,
          judged: c.judged,
          agents_audited: byCat.get(c.slug as CategorySlug)?.length ?? 0,
          url: `${base}/c/${c.slug}`,
        })),
        note: "judged categories are fixed by the BNB rubric and never grow; adjacent ones are detected from verified capability text",
      });
    },

    "get_opportunities": async (args) => {
      const category = typeof args.category === "string" && args.category in CATEGORIES
        ? (args.category as CategorySlug)
        : null;
      const limit = clamp(args.limit, 15, 50);
      const all = await loadOpportunities();
      const rows = (category ? all.filter((o) => o.category === category) : all).slice(0, limit);
      return text({
        total_indexed: all.length,
        returned: rows.length,
        category: category ?? "all",
        caveat: "reads age; each row's detail page shows the block it was read at",
        opportunities: rows.map((o) => ({
          id: o.id,
          label: o.label,
          category: o.category,
          venue: o.venue,
          eligible: o.eligible,
          ineligible_reason: o.ineligibleReason ?? null,
          url: `${base}/o/${encodeURIComponent(o.id)}`,
        })),
      });
    },

    "get_registry_stats": async () => {
      const c = await loadCensus();
      return text({
        tokens_minted: c.tokensMinted,
        censused: c.censused,
        agents_with_endpoint: c.withEndpoint,
        callable: c.callable,
        distinct_owners: c.owners,
        endpoint_operators: c.operators,
        top5_operator_share: `${c.top5OperatorShare.toFixed(2)}%`,
        x402_supported: c.x402Supported,
        live_read: c.live,
        measured_at: c.measuredAt,
        caveats: [
          "census reads the ERC-8004 registry on BNB Smart Chain (chain 56)",
          "callable means an endpoint answered a protocol handshake; probing runs from one region",
        ],
      });
    },

    "get_track_record": async (args) => {
      const id = String(args.token_id ?? "").trim();
      if (!/^\d+$/.test(id)) return text({ error: "token_id must be a number" }, true);
      const tr = await attestationSummary(id, 56).catch(() => null);
      if (!tr) {
        return text({
          token_id: id,
          note: "Track record could not be read right now. Unmeasured, not zero - and no agent is treated as bad because our read failed.",
        });
      }
      return text({
        token_id: id,
        attestations: tr.total,
        succeeded: tr.succeeded,
        partial: tr.partial,
        failed: tr.failed,
        disputed: tr.disputed,
        verified_evidence: tr.verified,
        distinct_attesters: tr.distinctAttesters,
        evidence_kinds: tr.evidenceKinds,
        caveat: "graded by an independent evaluator; GEBO never grades agents it lists",
        url: `${base}/a/${id}`,
      });
    },

    "get_verified_reviews": async (args) => {
      const id = String(args.token_id ?? "").trim();
      if (!/^\d+$/.test(id)) return text({ error: "token_id must be a number" }, true);
      const { reviews, unavailable, reason } = await reviewsFor(id, 20);
      if (unavailable) {
        return text({
          token_id: id,
          note: `Verified reviews could not be read right now (${reason ?? "read failed"}). Unmeasured, not zero.`,
        });
      }
      if (reviews.length === 0) {
        return text({
          token_id: id,
          count: 0,
          note: "No verified reviews - reviews require a completed APEX escrow job with the reviewer as its client. An absence, not a rating.",
        });
      }
      return text({
        token_id: id,
        count: reviews.length,
        note: "comments are evidence, not scores; review count tracks hire volume, not quality, and never affects ordering",
        reviews: reviews.map((r) => ({
          reviewer: r.reviewer,
          comment: r.comment,
          anchor: `chain ${r.chainId}, job ${r.jobId}, gate verified at block ${r.checkedBlock}`,
          created_at: r.createdAt,
        })),
        url: `${base}/a/${id}`,
      });
    },
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const res = NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400, headers: { ...CORS, "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } },
    );
    return res;
  }

  const { status, body: responseBody } = await handleMcpPost(body, toolsFor(request));
  const headers = { ...CORS, "MCP-Protocol-Version": MCP_PROTOCOL_VERSION };
  if (responseBody === null) return new NextResponse(null, { status, headers });
  return NextResponse.json(responseBody, { status, headers });
}

// A stateless server has no streams and no sessions to terminate.
export async function GET() {
  return new NextResponse(null, {
    status: 405,
    headers: { ...CORS, Allow: "POST, OPTIONS", "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
  });
}

export async function DELETE() {
  return new NextResponse(null, {
    status: 405,
    headers: { ...CORS, Allow: "POST, OPTIONS", "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
