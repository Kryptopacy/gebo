/**
 * How many VERIFIED agents advertise an endpoint nobody can reach?
 *
 * The probe graded an agent VERIFIED when its Agent Card was fetchable and well
 * formed. It never checked what the card's own `url` field pointed at - the address
 * an A2A client is supposed to send message/send to. Two agents found by hand
 * declare http://127.0.0.1:9104/ and http://127.0.0.1:9101/ there.
 *
 * This measures the population. The result is a denominator, not an anecdote: N of M
 * agents that passed our own verification cannot be hired by anyone.
 *
 * Read-only. Fetches cards, changes nothing.
 *
 * Run: npx tsx scripts/audit-card-endpoints.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { cardEndpointDefect } from "../src/lib/probe.ts";

const LIMIT = Number(process.env.AUDIT_LIMIT ?? 150);
const CONCURRENCY = 8;

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });

const targets = await sql<{ token_id: string; name: string | null; category: string | null; url: string }[]>`
  select a.token_id::text as token_id, a.name, a.category, e.url
  from agents a
  join agent_endpoints e on e.chain_id = a.chain_id and e.token_id = a.token_id
  where a.chain_id = 56
    and a.trust_state = 'VERIFIED'
    and e.kind = 'a2a'
  order by a.token_id desc
  limit ${LIMIT}
`;

console.log(`\n  Auditing ${targets.length} VERIFIED a2a endpoint(s) for an unreachable declared url\n`);

type Row = { token_id: string; name: string | null; category: string | null; defect: string; declared: string };
const defects: Row[] = [];
let fetched = 0;
let unreadable = 0;
let noUrl = 0;

async function check(t: (typeof targets)[number]) {
  try {
    const res = await fetch(t.url, {
      headers: { accept: "application/json", "user-agent": "gebo-card-audit" },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!res.ok) { unreadable++; return; }
    const card = (await res.json()) as Record<string, unknown>;
    fetched++;
    if (typeof card.url !== "string" || !card.url.trim()) { noUrl++; return; }
    const defect = cardEndpointDefect(card.url);
    if (defect) {
      defects.push({
        token_id: t.token_id,
        name: t.name,
        category: t.category,
        defect,
        declared: card.url,
      });
    }
  } catch {
    unreadable++;
  }
}

for (let i = 0; i < targets.length; i += CONCURRENCY) {
  await Promise.all(targets.slice(i, i + CONCURRENCY).map(check));
  process.stdout.write(`\r  checked ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}`);
}
process.stdout.write("\n\n");

console.log(`  RESULT`);
console.log(`    cards read cleanly        ${fetched}`);
console.log(`    card unreadable now      ${unreadable}   (was VERIFIED at last probe)`);
console.log(`    card declares no url     ${noUrl}   (legal: skills or capabilities instead)`);
console.log(`    UNREACHABLE ENDPOINT     ${defects.length} of ${fetched}`);

if (defects.length) {
  console.log(`\n  AGENTS THAT CANNOT BE HIRED BY ANYONE`);
  for (const d of defects) {
    console.log(`    #${d.token_id.padEnd(8)} ${(d.name ?? "").slice(0, 30).padEnd(31)} ${d.category ?? "-"}`);
    console.log(`               declares ${d.declared.slice(0, 48)}`);
    console.log(`               ${d.defect.slice(0, 96)}`);
  }
  const byKind = new Map<string, number>();
  for (const d of defects) {
    const k = /loopback/.test(d.defect) ? "loopback" : /private/.test(d.defect) ? "private address" : /local-only/.test(d.defect) ? "local-only name" : "other";
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  console.log(`\n  BY KIND`);
  for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
  console.log(
    `\n  Each of these passed our own VERIFIED grade, because the grade tested whether\n` +
    `  the CARD answered rather than whether the endpoint it names is reachable.\n`,
  );
} else {
  console.log(`\n  No sampled agent declares an unreachable endpoint.\n`);
}

await sql.end({ timeout: 5 });
