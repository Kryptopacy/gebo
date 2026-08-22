/**
 * Scheduled emerging-capability detection.
 *
 * The detector existed as a script that printed to a terminal, so a new capability
 * appearing on BNB Chain produced silence until somebody remembered to run it.
 * Nobody would. This is what turns detection from an errand into a standing
 * measurement, and it is the mechanism by which the taxonomy keeps pace with the
 * ecosystem instead of freezing at whatever nine rule sets were written first.
 *
 * IT DOES NOT CREATE CATEGORIES. It records candidates and their evidence. The
 * reason is measured rather than assumed: term frequency nominated `unibase`, an
 * operator, on 17 verified texts, plus `swan` and `black` from memecoin titles and
 * the function word `not`. Four candidates cleared the bar and all four were
 * noise. Promotion is a person reading the agents behind a term, and only ever
 * into an ADJACENT category - the judged four are fixed by the rubric.
 *
 * Daily rather than every ten minutes: this scans the unclassified corpus and
 * collapses duplicate text, and a new capability category does not emerge on a
 * ten-minute cadence.
 */
import { NextResponse } from "next/server";
import postgres from "postgres";
import { authorizeCron } from "@/lib/cron-auth";
import { RULES_FINGERPRINT } from "@/lib/classify";
import { detectEmerging, warrantsReview, type EmergingInput } from "@/lib/emerging";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = {
  name: string | null;
  description: string | null;
  skills: string[] | null;
  trust_state: string;
  operator_key: string | null;
  operator_domain: string | null;
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
      select a.name, a.description, a.skills, a.trust_state, a.operator_key,
             o.registrable_domain as operator_domain
      from agents a
      left join operators o on o.key = a.operator_key
      where a.chain_id = 56
        and a.category is null
        and a.skills is not null
    `;

    const input: EmergingInput[] = rows.map((r) => ({
      name: r.name,
      description: r.description,
      skills: r.skills,
      trustState: r.trust_state,
      operatorDomain: r.operator_domain,
      operatorKey: r.operator_key,
    }));

    const result = detectEmerging(input);
    const worth = result.candidates.filter(warrantsReview);

    /**
     * Only candidates that warrant review are persisted.
     *
     * The table is publicly readable and states that the taxonomy is incomplete,
     * which is a claim worth making honestly. Filling it with terms that failed
     * the operator-spanning test would turn an admission into noise.
     */
    if (worth.length) {
      const payload = worth.map((c) => ({
        term: c.term,
        distinct_texts: c.distinctTexts,
        verified_texts: c.verifiedTexts,
        distinct_operators: c.distinctOperators,
        example_agents: c.examples,
      }));

      await sql`
        insert into category_candidates
          (term, chain_id, distinct_texts, verified_texts, distinct_operators,
           example_agents, rules_fingerprint, first_seen_at, last_seen_at)
        select
          e ->> 'term',
          56,
          (e ->> 'distinct_texts')::int,
          (e ->> 'verified_texts')::int,
          (e ->> 'distinct_operators')::int,
          array(select jsonb_array_elements_text(e -> 'example_agents')),
          ${RULES_FINGERPRINT},
          now(),
          now()
        from jsonb_array_elements(${sql.json(payload as any)}::jsonb) e
        on conflict (chain_id, term) do update set
          distinct_texts     = excluded.distinct_texts,
          verified_texts     = excluded.verified_texts,
          distinct_operators = excluded.distinct_operators,
          example_agents     = excluded.example_agents,
          rules_fingerprint  = excluded.rules_fingerprint,
          last_seen_at       = now()
        -- A term already triaged stays triaged. Re-nominating something a person
        -- rejected would reopen a settled decision on every run.
        where category_candidates.status = 'candidate'
      `;
    }

    /**
     * Terms that no longer appear are not deleted.
     *
     * A candidate that stops showing up is itself a finding - the agents behind it
     * may have gone offline - and deleting the row would erase the evidence that
     * the term was ever seen. last_seen_at carries the staleness instead.
     */
    const [open] = await sql<{ n: number }[]>`
      select count(*)::int as n from category_candidates
      where chain_id = 56 and status = 'candidate'
    `;

    return NextResponse.json({
      ok: true,
      rules: RULES_FINGERPRINT,
      /** Agents that declare a skill and match no rule. */
      examined: result.examined,
      /** Of those, ones whose skill text is only the listing's own title. */
      titleOnly: result.titleOnly,
      distinctTexts: result.distinctTexts,
      detected: result.candidates.length,
      persisted: worth.length,
      openCandidates: open?.n ?? 0,
      suppressed: result.suppressed.length,
      ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
