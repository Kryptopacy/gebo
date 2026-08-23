/**
 * Incremental probe cron.
 *
 * Keeps liveness data current so the site is genuinely real-time rather than a
 * snapshot of whenever someone last ran a script by hand.
 *
 * Only probes endpoints whose next_probe_at has come due, in a batch small
 * enough to finish inside the serverless limit. Cadence is tiered by the last
 * outcome, so responsive agents are re-checked every 15 minutes while dead ones
 * are left alone for days:
 *
 *   tier 0  validated       -> 15 minutes
 *   tier 1  responded       -> 6 hours
 *   tier 2  failed          -> 3 days
 *   tier 3  fatal lint      -> never requested; a broken URL cannot improve
 *
 * Repeated runs are what turn n=1 observations into real uptime: probe_daily
 * accumulates counters per endpoint per day, and probe_events records only
 * transitions.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { authorizeCron } from "@/lib/cron-auth";
import { probeEndpoint, type Endpoint } from "@/lib/probe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = Number(process.env.CRON_PROBE_BATCH ?? 45);
const CONCURRENCY = 12;
const HOST_GAP_MS = 250;

type Target = {
  endpoint_id: number;
  token_id: string;
  kind: string;
  url: string;
  host: string | null;
  trust_state: string | null;
};

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });
  }

  const startedAt = Date.now();
  const sql = postgres(url, { prepare: false, max: 4, connect_timeout: 10, onnotice: () => {} });

  try {
    const targets = await sql<Target[]>`
      select e.id as endpoint_id, a.token_id::text as token_id,
             e.kind, e.url, e.host, a.trust_state
      from agent_endpoints e
      join agents a on a.chain_id = e.chain_id and a.token_id = e.token_id
      where e.chain_id = 56
        and e.url <> ''
        and e.kind in ('a2a', 'mcp')
        and e.probe_tier < 3
        and (e.next_probe_at is null or e.next_probe_at <= now())
      order by e.next_probe_at asc nulls first
      limit ${BATCH}
    `;

    if (!targets.length) {
      return NextResponse.json({ ok: true, probed: 0, note: "nothing due" });
    }

    const hostNext = new Map<string, number>();
    const tally = { validated: 0, responded: 0, failed: 0 };
    let cursor = 0;
    const today = new Date().toISOString().slice(0, 10);

    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= targets.length) return;
        // Stop early rather than risk being killed mid-write by the platform.
        if (Date.now() - startedAt > 45_000) return;

        const t = targets[i]!;

        if (t.host) {
          const now = Date.now();
          const next = Math.max(hostNext.get(t.host) ?? 0, now);
          hostNext.set(t.host, next + HOST_GAP_MS);
          if (next > now) await new Promise((r) => setTimeout(r, next - now));
        }

        const o = await probeEndpoint({ kind: t.kind as Endpoint["kind"], url: t.url });
        tally[o.grade]++;

        const state = o.grade === "validated" ? "VERIFIED" : o.grade === "responded" ? "LISTED" : "DORMANT";
        const tier = o.grade === "validated" ? 0 : o.grade === "responded" ? 1 : 2;
        const nextIn = tier === 0 ? "15 minutes" : tier === 1 ? "6 hours" : "3 days";
        const reason =
          o.grade === "validated"
            ? `completed a ${t.kind.toUpperCase()} handshake in ${o.rttMs} ms`
            : o.errDetail ?? `no usable response (${o.errClass})`;

        await sql`
          insert into probes_raw ${sql({
            endpoint_id: t.endpoint_id, grade: o.grade, http_status: o.httpStatus,
            rtt_ms: o.rttMs, err_class: o.errClass,
            evidence: o.evidence ? sql.json(o.evidence as any) : null,
          } as any)}
        `;

        await sql`
          insert into probe_daily ${sql({
            endpoint_id: t.endpoint_id, day: today, probes: 1,
            ok_count: o.grade === "failed" ? 0 : 1,
            validated_count: o.grade === "validated" ? 1 : 0,
            p50_ms: o.rttMs, p95_ms: o.rttMs,
            fail_streak: o.grade === "failed" ? 1 : 0,
            last_ok_at: o.grade === "failed" ? null : new Date(),
            err_counts: sql.json({ [o.errClass]: 1 }),
          } as any)}
          on conflict (endpoint_id, day) do update set
            probes          = probe_daily.probes + 1,
            ok_count        = probe_daily.ok_count + excluded.ok_count,
            validated_count = probe_daily.validated_count + excluded.validated_count,
            p50_ms          = (probe_daily.p50_ms + excluded.p50_ms) / 2,
            p95_ms          = greatest(probe_daily.p95_ms, excluded.p95_ms),
            fail_streak     = case when excluded.fail_streak = 0 then 0
                                   else probe_daily.fail_streak + 1 end,
            last_ok_at      = coalesce(excluded.last_ok_at, probe_daily.last_ok_at),
            -- Accumulate. This was omitted, so err_counts held only the FIRST
            -- probe of each endpoint-day while probes counted every one, and the
            -- breakdown's totals could never match its own denominator.
            err_counts      = public.merge_err_counts(probe_daily.err_counts, excluded.err_counts)
        `;

        // A change of state is news; an unchanged state is not.
        if (t.trust_state && t.trust_state !== "SHADOWED" && t.trust_state !== state) {
          await sql`
            insert into probe_events ${sql({
              endpoint_id: t.endpoint_id, from_grade: t.trust_state, to_grade: state,
              http_status: o.httpStatus, err_class: o.errClass,
              detail: (o.errDetail ?? "").slice(0, 200) || null,
            } as any)}
          `;
        }

        // Never overwrite SHADOWED: a fatal registration defect outranks a probe.
        await sql`
          update agents set trust_state = ${state}, trust_reason = ${reason.slice(0, 300)}, updated_at = now()
          where chain_id = 56 and token_id = ${t.token_id} and trust_state <> 'SHADOWED'
        `;

        await sql`
          update agent_endpoints
          set probe_tier = ${tier}, next_probe_at = now() + ${nextIn}::interval
          where id = ${t.endpoint_id}
        `;
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const [due] = await sql<{ n: number }[]>`
      select count(*)::int as n from agent_endpoints
      where chain_id = 56 and probe_tier < 3 and kind in ('a2a','mcp')
        and (next_probe_at is null or next_probe_at <= now())
    `;

    return NextResponse.json({
      ok: true,
      probed: tally.validated + tally.responded + tally.failed,
      ...tally,
      stillDue: due?.n ?? 0,
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err).slice(0, 300) },
      { status: 500 },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
