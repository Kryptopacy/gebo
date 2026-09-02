/**
 * Tools the GEBO assistant can call, backed by the same data layer the UI reads.
 *
 * The assistant must never quote registry numbers from memory: every figure the
 * product publishes is measured, and a stale number spoken confidently is worse
 * than no assistant. So factual questions about agents, categories and the
 * funnel are answered through these tools, which read live from the database.
 *
 * Executors return plain JSON-able objects and NEVER throw - a failed tool call
 * returns { error } so the model can say "I could not read that" instead of the
 * request failing outright.
 */
import { getClient } from "../db";
import {
  searchAgents, findAgent, loadCensus, opportunitiesFor, CATEGORIES,
  type CategorySlug,
} from "./data";
import { agentMetrics } from "./metrics";
import { attestationSummary } from "./attestations";
import { reviewsFor } from "./reviews";

/**
 * Tool declarations for the Interactions API: plain lowercase JSON Schema
 * parameters, one function per tool. The legacy generateContent shape used
 * uppercase enum types (OBJECT/STRING); this API does not.
 */
export const TOOL_DECLARATIONS = [
  {
    type: "function" as const,
    name: "search_agents",
    description:
      "Search GEBO's registry of BNB Chain agents by capability, name or skill. " +
      "Returns the best matching agents with their trust state and a link to their card.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the user is looking for, e.g. 'venus health factor' or 'grid trading'" },
        category: {
          type: "string",
          description: "Optional category slug to narrow results: rebalancing, grid, yield, health, trading, research, payments, social, infra",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function" as const,
    name: "get_agent",
    description:
      "Get one agent's full card data by its token id: what it does, trust state, " +
      "liveness, uptime, latency and track record summary.",
    parameters: {
      type: "object",
      properties: {
        token_id: { type: "string", description: "The agent's numeric token id, e.g. 259573" },
      },
      required: ["token_id"],
    },
  },
  {
    type: "function" as const,
    name: "list_categories",
    description:
      "Count agents per category across the registry, with how many are verified. " +
      "Use for questions like 'how many agents do X' or 'which category has the most agents'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function" as const,
    name: "get_opportunities",
    description:
      "Live on-chain opportunities for one of the four judged categories " +
      "(rebalancing, grid, yield, health): PancakeSwap pools or Venus markets with real numbers.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "One of: rebalancing, grid, yield, health" },
      },
      required: ["category"],
    },
  },
  {
    type: "function" as const,
    name: "get_registry_stats",
    description:
      "The registry funnel: how many agents are minted, how many are readable, how many " +
      "declare endpoints, how many are actually callable. Use for any question about the " +
      "size or shape of the BNB Chain agent ecosystem.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function" as const,
    name: "get_track_record",
    description:
      "Attestation ledger summary for one agent: tasks recorded, succeeded, independently " +
      "verified evidence, distinct attesters. Graded by an independent evaluator contract; " +
      "GEBO never grades agents it lists.",
    parameters: {
      type: "object",
      properties: {
        token_id: { type: "string", description: "The agent's numeric token id, e.g. 259573" },
      },
      required: ["token_id"],
    },
  },
  {
    type: "function" as const,
    name: "get_verified_reviews",
    description:
      "Verified reviews for one agent: free-text comments from wallets that completed an " +
      "APEX escrow job as its client, each anchored to an on-chain job id. Comments are " +
      "evidence, not scores - GEBO has no ratings, and reviews never affect ordering. " +
      "An empty result means no completed hire exists yet, not that the agent is bad.",
    parameters: {
      type: "object",
      properties: {
        token_id: { type: "string", description: "The agent's numeric token id, e.g. 259573" },
      },
      required: ["token_id"],
    },
  },
];

const CATS = Object.keys(CATEGORIES) as CategorySlug[];

export async function executeAssistantTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case "search_agents": {
        const query = String(args.query ?? "").slice(0, 120);
        const category = typeof args.category === "string" ? args.category : null;
        if (!query) return { error: "empty query" };
        let hits = await searchAgents(query, 20);
        if (category) hits = hits.filter((h) => h.agent.category === category);
        return {
          results: hits.slice(0, 5).map((h) => ({
            tokenId: h.agent.token_id,
            name: h.agent.name,
            state: h.agent.trust_state,
            category: h.agent.category,
            why: h.why,
            cardUrl: `/a/${h.agent.token_id}`,
            hireUrl: `/a/${h.agent.token_id}/hire`,
          })),
          note: "State VERIFIED means it completed a protocol handshake. Card URL is relative to the GEBO site root.",
        };
      }

      case "get_agent": {
        const tokenId = String(args.token_id ?? "").replace(/[^0-9]/g, "");
        if (!tokenId) return { error: "token_id required" };
        const a = await findAgent(tokenId);
        if (!a) return { error: `no agent with token id ${tokenId}` };
        const metrics = await agentMetrics(56, tokenId);
        const up = metrics.find((m) => m.metricId === "uptime_7d");
        const p50 = metrics.find((m) => m.metricId === "latency_p50_7d");
        return {
          tokenId: a.token_id,
          name: a.name,
          description: a.description?.slice(0, 400) ?? null,
          state: a.trust_state,
          stateReason: a.trust_reason,
          category: a.category,
          skills: a.skills?.slice(0, 6) ?? [],
          protocols: a.protocols,
          uptime7d: up ? { value: up.value, observations: up.qualifiers.obsCount } : null,
          latencyP507d: p50 ? { value: p50.value } : null,
          lastProbe: a.probe
            ? { grade: a.probe.grade, rttMs: a.probe.rttMs, httpStatus: a.probe.httpStatus }
            : null,
          cardUrl: `/a/${a.token_id}`,
          hireUrl: `/a/${a.token_id}/hire`,
        };
      }

      case "list_categories": {
        const sql = getClient();
        const rows = await sql<{ category: string; n: number; verified: number }[]>`
          select category, count(*)::int as n,
                 count(*) filter (where trust_state = 'VERIFIED')::int as verified
          from agents
          where chain_id = 56 and category is not null
          group by category
          order by n desc`;
        return {
          categories: rows.map((r) => ({
            slug: r.category,
            job: CATEGORIES[r.category as CategorySlug]?.job ?? r.category,
            agents: r.n,
            verified: r.verified,
            pageUrl: `/c/${r.category}`,
          })),
        };
      }

      case "get_opportunities": {
        const raw = String(args.category ?? "");
        const slug = (CATS.includes(raw as CategorySlug) ? raw : "yield") as CategorySlug;
        const opps = await opportunitiesFor(slug);
        const eligible = opps.filter((o) => o.eligible).slice(0, 5);
        return {
          category: slug,
          totalIndexed: opps.filter((o) => o.eligible).length,
          opportunities: eligible.map((o) => ({
            label: o.label,
            venue: o.venue,
            detailUrl: `/o/${o.id}`,
            payload: o.payload,
          })),
          note: "Payload fields are raw on-chain values for this category (tick, APR, utilisation etc).",
        };
      }

      case "get_registry_stats": {
        const c = await loadCensus();
        return {
          minted: c.tokensMinted,
          readableRegistrations: c.resolved,
          claimActive: c.claimActive,
          declareEndpoint: c.withEndpoint,
          callable: c.callable,
          operators: c.operators,
          owners: c.owners,
          measuredAt: c.measuredAt,
          note:
            "callable = declares A2A or MCP and survives a registration audit. " +
            "claimActive is self-declared and unverified.",
        };
      }

      case "get_track_record": {
        const tokenId = String(args.token_id ?? "").replace(/[^0-9]/g, "");
        if (!tokenId) return { error: "token_id required" };
        const tr = await attestationSummary(tokenId, 56);
        if (!tr) {
          // Unmeasured, not zero - the assistant must say it could not read,
          // never that the agent has no record.
          return { error: `track record for ${tokenId} could not be read right now` };
        }
        return {
          tokenId,
          attestations: tr.total,
          succeeded: tr.succeeded,
          partial: tr.partial,
          failed: tr.failed,
          disputed: tr.disputed,
          verifiedEvidence: tr.verified,
          distinctAttesters: tr.distinctAttesters,
          note: "graded by an independent evaluator; GEBO never grades agents it lists",
        };
      }

      case "get_verified_reviews": {
        const tokenId = String(args.token_id ?? "").replace(/[^0-9]/g, "");
        if (!tokenId) return { error: "token_id required" };
        const { reviews, unavailable, reason } = await reviewsFor(tokenId, 10);
        if (unavailable) {
          return { error: `verified reviews for ${tokenId} could not be read right now (${reason ?? "read failed"})` };
        }
        if (reviews.length === 0) {
          return {
            tokenId,
            count: 0,
            note: "no verified reviews - reviews require a completed APEX escrow job with the reviewer as its client. An absence, not a rating.",
          };
        }
        return {
          tokenId,
          count: reviews.length,
          reviews: reviews.map((r) => ({
            reviewer: r.reviewer,
            comment: r.comment,
            anchor: `chain ${r.chainId} job ${r.jobId}, verified at block ${r.checkedBlock}`,
            createdAt: r.createdAt,
          })),
          note: "comments are evidence, not scores; they never affect ordering",
        };
      }

      default:
        return { error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { error: String((e as Error).message ?? e).slice(0, 160) };
  }
}
