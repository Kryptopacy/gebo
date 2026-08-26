/**
 * Probe-derived history for any agent with a declared endpoint.
 *
 * Every probe is evidence: it proves the agent answered, how fast, and whether
 * the response was structurally valid. This surfaces that evidence as a track
 * record for EVERY agent — not just the handful we've tested manually.
 *
 * probe_daily accumulates per-endpoint per-day counters: total probes,
 * success count, validated count, p50 latency, fail streak. This function
 * reads the last 14 days and returns it in a format the agent card can render
 * as a timeline.
 */
import postgres from "postgres";
import { getClient } from "../db";

export type ProbeDay = {
  date: string;
  probes: number;
  okCount: number;
  validatedCount: number;
  p50Ms: number;
  failStreak: number;
  uptimePct: number | null;
};

export type ProbeHistory = {
  days: ProbeDay[];
  totalProbes: number;
  totalOk: number;
  overallUptime: number | null;
  avgP50: number | null;
  endpointUrl: string | null;
  endpointKind: string | null;
};

export async function probeHistoryFor(
  tokenId: string,
  chainId: number,
): Promise<ProbeHistory | null> {
  try {
    const sql = getClient();

    // Get the agent's endpoint info
    const eps = await sql<{ url: string; kind: string }[]>`
      select url, kind from agent_endpoints
      where chain_id = ${chainId} and token_id = ${tokenId} and kind in ('a2a', 'mcp')
      limit 1`;

    if (!eps.length) return null;

    // Get daily probe data for the last 14 days
    const rows = await sql<{
      day: string;
      probes: number;
      ok_count: number;
      validated_count: number;
      p50_ms: number;
      fail_streak: number;
    }[]>`
      select day, probes, ok_count, validated_count, p50_ms, fail_streak
      from probe_daily pd
      join agent_endpoints ae on ae.id = pd.endpoint_id
      where ae.chain_id = ${chainId}
        and ae.token_id = ${tokenId}
        and ae.kind in ('a2a', 'mcp')
        and pd.day >= (current_date - interval '14 days')::text
      order by pd.day desc`;

    if (!rows.length) return null;

    const days: ProbeDay[] = rows.map((r) => ({
      date: r.day,
      probes: r.probes,
      okCount: r.ok_count,
      validatedCount: r.validated_count,
      p50Ms: r.p50_ms,
      failStreak: r.fail_streak,
      uptimePct: r.probes > 0 ? Math.round((r.ok_count / r.probes) * 1000) / 10 : null,
    }));

    const totalProbes = days.reduce((s, d) => s + d.probes, 0);
    const totalOk = days.reduce((s, d) => s + d.okCount, 0);
    const p50s = days.filter((d) => d.p50Ms > 0).map((d) => d.p50Ms);

    return {
      days,
      totalProbes,
      totalOk,
      overallUptime: totalProbes > 0 ? Math.round((totalOk / totalProbes) * 1000) / 10 : null,
      avgP50: p50s.length > 0 ? Math.round(p50s.reduce((a, b) => a + b, 0) / p50s.length) : null,
      endpointUrl: eps[0].url,
      endpointKind: eps[0].kind,
    };
  } catch {
    return null;
  }
}
