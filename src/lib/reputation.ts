/**
 * ERC-8004 Reputation Registry write-back.
 *
 * This is the claim GEBO makes loudest: it produces liveness data rather than
 * reselling somebody else's, and publishes it where anyone can read it. A
 * measurement kept in our own database is our asset; the same measurement in the
 * Reputation Registry is the ecosystem's.
 *
 * ADDRESSES, from the curated deployment list at
 * github.com/erc-8004/erc-8004-contracts, verified live on chain (130-byte
 * proxies, getSummary responds). Probing vanity prefixes found nothing - the
 * mainnet Reputation Registry is 0x8004BAa1..., not the 0x8004b169... a naive
 * guess suggests.
 *
 * ENCODING follows the v2.0 feedback profile (January 2026). An earlier design
 * here refused to write `reachable` on the grounds that a 1/0 value would read as
 * a one-star review. That was wrong: the standard's own metric table specifies
 * exactly that encoding, because meaning is carried by tag1 rather than by the
 * number's range.
 *
 *   tag1            value  decimals  meaning
 *   uptime           9977         2  99.77%
 *   successRate      9950         2  99.50%
 *   responseTime      560         0  560 ms
 *   reachable           1         0  binary
 *
 * SELF-FEEDBACK IS BLOCKED BY THE CONTRACT for an agent's owner or operator, so
 * the writer key must never own a listed agent.
 */
import { parseAbi, type Address, type Hex } from "viem";

export const REPUTATION_REGISTRY = {
  56: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  97: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
} as const satisfies Record<number, Address>;

export const IDENTITY_REGISTRY = {
  56: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  97: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const satisfies Record<number, Address>;

export const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function revokeFeedback(uint256 agentId, uint64 feedbackIndex)",
]);

/** Metric shapes the standard defines. Anything else must not be invented here. */
export type MetricTag = "uptime" | "successRate" | "responseTime" | "reachable";

export type FeedbackValue = {
  tag1: MetricTag;
  value: bigint;
  valueDecimals: number;
  /** What the pair means once decoded, for logging and for the off-chain file. */
  human: string;
};

/** 99.77% -> value 9977, decimals 2. Two decimals is the standard's example. */
export function percentMetric(tag: "uptime" | "successRate", pct: number): FeedbackValue {
  const clamped = Math.max(0, Math.min(100, pct));
  const value = BigInt(Math.round(clamped * 100));
  return { tag1: tag, value, valueDecimals: 2, human: `${(Number(value) / 100).toFixed(2)}%` };
}

/** Milliseconds, integer. Never scaled: the standard stores 560 as 560. */
export function responseTimeMetric(ms: number): FeedbackValue {
  const v = BigInt(Math.max(0, Math.round(ms)));
  return { tag1: "responseTime", value: v, valueDecimals: 0, human: `${v} ms` };
}

/** Binary, per the standard's metric table. */
export function reachableMetric(reachable: boolean): FeedbackValue {
  return { tag1: "reachable", value: reachable ? 1n : 0n, valueDecimals: 0, human: reachable ? "reachable" : "unreachable" };
}

/** CAIP-10, which the v2.0 profile requires for addresses. */
export function caip10(chainId: number, address: string): string {
  return `eip155:${chainId}:${address}`;
}

export type FeedbackFile = {
  agentRegistry: string;
  agentId: number;
  clientAddress: string;
  createdAt: string;
  value: string;
  valueDecimals: number;
  tag1: string;
  tag2?: string;
  endpoint?: string;
  reasoning: string;
  /** Non-standard but honest: how the figure was produced and its limits. */
  method: {
    measuredBy: string;
    probes: number;
    windowDays: number;
    vantage: string;
    knownDefects: string[];
  };
};

/**
 * Build the off-chain file referenced by feedbackURI.
 *
 * The profile's first best practice is "always provide reasoning", so the number
 * never travels alone. The method block goes further and states the observation
 * count and the single-region limitation, because a figure whose construction is
 * hidden is not evidence.
 */
export function buildFeedbackFile(args: {
  chainId: 56 | 97;
  agentId: string;
  writer: Address;
  metric: FeedbackValue;
  endpoint?: string | null;
  probes: number;
  windowDays: number;
  tag2?: string;
}): FeedbackFile {
  const { chainId, agentId, writer, metric, endpoint, probes, windowDays } = args;
  return {
    agentRegistry: caip10(chainId, IDENTITY_REGISTRY[chainId]),
    agentId: Number(agentId),
    clientAddress: caip10(chainId, writer),
    createdAt: new Date().toISOString(),
    value: metric.value.toString(),
    valueDecimals: metric.valueDecimals,
    tag1: metric.tag1,
    ...(args.tag2 ? { tag2: args.tag2 } : {}),
    ...(endpoint ? { endpoint } : {}),
    reasoning:
      `Measured by GEBO from ${probes} scheduled probe(s) over ${windowDays} day(s): ` +
      `${metric.human}. A probe counts as successful only when the endpoint completes an ` +
      `A2A agent-card parse or an MCP initialize handshake; an HTTP 200 alone is not counted.`,
    method: {
      measuredBy: "GEBO (gebo-bsc.vercel.app)",
      probes,
      windowDays,
      vantage: "single region",
      knownDefects: [
        "Single vantage point: an agent that geo-blocks or ASN-blocks the prober appears unreachable.",
        "Cannot distinguish 'the agent is down' from 'unreachable from here'.",
        "Latency includes network path and cold starts, so a slow figure is not necessarily a slow agent.",
      ],
    },
  };
}

/**
 * Encode the file as a data URI.
 *
 * Chosen over IPFS deliberately: a data URI cannot rot. The whole argument for
 * writing on chain is that the measurement outlives us, and an IPFS pin that
 * stops being paid for would undo that.
 */
export function toDataUri(file: FeedbackFile): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(file), "utf8").toString("base64")}`;
}

/**
 * Should this measurement be published at all?
 *
 * On-chain feedback is permanent, and the spec notes such pointers cannot be
 * deleted. Publishing a wrong negative would permanently misrepresent a working
 * agent, so the bar is deliberately conservative and asymmetric.
 */
export function publishable(args: {
  probes: number;
  windowDays: number;
  populationFailureRate: number;
}): { ok: boolean; reason: string } {
  const { probes, windowDays, populationFailureRate } = args;

  if (probes < 20) {
    return { ok: false, reason: `only ${probes} probes; 20 required before publishing` };
  }
  if (windowDays < 1) {
    return { ok: false, reason: "less than a day of history" };
  }
  /**
   * If most of the population failed in the same window, the fault is far more
   * likely ours - our network, our DNS, our egress - than tens of thousands of
   * agents failing at once. Publishing then would defame them at our expense.
   */
  if (populationFailureRate > 0.5) {
    return {
      ok: false,
      reason: `population failure rate ${(populationFailureRate * 100).toFixed(0)}% suggests our own fault, not theirs`,
    };
  }
  return { ok: true, reason: `${probes} probes over ${windowDays} day(s)` };
}

export type WriteBackPlan = {
  agentId: string;
  metric: FeedbackValue;
  tag2: string;
  endpoint: string | null;
  feedbackURI: string;
  feedbackHash: Hex;
  skipReason: string | null;
};
