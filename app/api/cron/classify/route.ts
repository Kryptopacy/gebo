/**
 * Scheduled classification.
 *
 * Without this, capability text arrives continuously and nothing ever reads it.
 * The probe job captures A2A card skills every five minutes, the resolver adds
 * descriptions every minute, and classification only ever ran when someone
 * executed a script by hand - so newly discovered agents sat unclassified and
 * invisible to category browsing. That is the same failure as hardcoding the
 * funnel figures: correct once, then quietly wrong.
 *
 * Two passes per invocation, both bounded:
 *   1. agents with capability text and no category   (the backlog)
 *   2. agents whose card was refetched since they were last classified
 *      (a changed agent card can change what an agent does)
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { authorizeCron } from "@/lib/cron-auth";
import { classifyCapability } from "@/lib/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SLICE = Number(process.env.CRON_CLASSIFY_SLICE ?? 2000);

type Row = {
  token_id: string;
  name: string | null;
  description: string | null;
  skills: string[] | null;
};

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ ok: false, error: "DATABASE_URL not set" }, { status: 503 });

  const startedAt = Date.now();
  const sql = postgres(url, { prepare: false, max: 3, connect_timeout: 10, onnotice: () => {} });

  try {
    const rows = await sql<Row[]>`
      select token_id::text as token_id, name, description, skills
      from agents
      where chain_id = 56
        and (name is not null or description is not null or skills is not null)
        and (
          category is null
          -- Reclassify when the card was refetched after the last classification.
          or (card_fetched_at is not null and card_fetched_at > coalesce(classified_at, 'epoch'::timestamptz))
        )
      order by
        case when skills is not null then 0 else 1 end,
        token_id desc
      limit ${SLICE}
    `;

    if (!rows.length) {
      return NextResponse.json({ ok: true, examined: 0, note: "nothing to classify" });
    }

    const payload: { token_id: string; category: string | null; matched: string[] | null }[] = [];
    let assigned = 0;
    let judged = 0;
    const dist: Record<string, number> = {};

    for (const r of rows) {
      const c = classifyCapability({ name: r.name, description: r.description, skills: r.skills });
      if (c.category) {
        assigned++;
        if (c.judged) judged++;
        dist[c.category] = (dist[c.category] ?? 0) + 1;
      }
      payload.push({
        token_id: r.token_id,
        category: c.category,
        matched: c.matched.length ? c.matched : null,
      });
    }

    // jsonb rather than parallel arrays: unnest(text[][]) flattens a 2-D array
    // and cannot produce one array per row for the evidence column.
    for (let i = 0; i < payload.length; i += 500) {
      await sql`
        update agents a set
          category = v.category,
          category_matched = v.matched,
          classified_at = now(),
          updated_at = now()
        from (
          select
            (e ->> 'token_id')::bigint as token_id,
            e ->> 'category'           as category,
            case
              when e -> 'matched' is null or e -> 'matched' = 'null'::jsonb then null
              else array(select jsonb_array_elements_text(e -> 'matched'))
            end                        as matched
          from jsonb_array_elements(${sql.json(payload.slice(i, i + 500) as any)}::jsonb) e
        ) v
        where a.chain_id = 56 and a.token_id = v.token_id
      `;
    }

    const remaining = await sql<{ n: number }[]>`
      select count(*)::int as n from agents
      where chain_id = 56
        and (name is not null or description is not null or skills is not null)
        and category is null
    `;

    return NextResponse.json({
      ok: true,
      examined: rows.length,
      assigned,
      judged,
      distribution: dist,
      stillUnclassified: remaining[0]?.n ?? 0,
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
