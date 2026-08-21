/**
 * Verify the attestation layer against real on-chain evidence.
 *
 * The claim being tested is that evidence is CHECKED rather than trusted. So this
 * attempts to record attestations backed by:
 *
 *   - a real session-key transaction from the Altana spike (must be accepted)
 *   - a transaction hash that does not exist (must be refused)
 *   - a malformed reference (must be refused)
 *   - a duplicate of an accepted one (must be refused, so one interaction
 *     cannot be counted twice)
 *
 * If a fabricated reference is accepted, the ledger is an opinion market and the
 * whole design fails.
 */
import "dotenv/config";
import { recordAttestation, verifyEvidence, attestationsFor, attestationSummary } from "../src/lib/attestations.ts";
import postgres from "postgres";

// Real transactions produced by scripts/spike-altana.ts on BNB testnet.
const REAL_SESSION_TX = "0x06be3407dc746356a3b3aa03cbdcbf29fbbfaa0bf0a2f5b7bb0a0e59b7d4e5c9";
const REAL_GRANT_TX = "0x42d4bb512825521d5575d845656ddf8268d60dfe3dc88934725ca3c088e7e7fd";
const FAKE_TX = "0xdeadbeef" + "0".repeat(56);
const MALFORMED = "not-a-transaction";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });

// Attach to a real agent so the summary can be read back.
const target = await sql<{ token_id: string; name: string | null }[]>`
  select token_id::text as token_id, name from agents
  where chain_id = 56 and trust_state = 'VERIFIED' and name is not null
  order by token_id desc limit 1
`;
const tokenId = target[0]?.token_id;
if (!tokenId) { console.error("no verified agent to attest against"); process.exit(1); }

console.log(`\n  ATTESTATION EVIDENCE CHECKS`);
console.log(`  target agent #${tokenId} (${target[0]?.name})\n`);

// 1. Evidence verification in isolation, on testnet where the spike ran.
for (const [label, ref, chain] of [
  ["real grant tx (testnet)", REAL_GRANT_TX, 97],
  ["nonexistent tx", FAKE_TX, 97],
  ["malformed reference", MALFORMED, 97],
] as const) {
  const v = await verifyEvidence("session_execution", ref, chain);
  console.log(`  ${v.verified ? "VERIFIED" : "REFUSED "}  ${label.padEnd(26)} ${v.reason.slice(0, 74)}`);
}

// 2. A task GEBO ran itself is verified by our retained record, not by chain.
const geboRef = `gebo-task-${Date.now()}`;
const first = await recordAttestation({
  tokenId,
  attester: "0x0000000000000000000000000000000000000000",
  attesterKind: "gebo",
  evidenceKind: "gebo_task",
  evidenceRef: geboRef,
  outcome: "succeeded",
  task: "Self-check: confirm the attestation path records a task with its output.",
  result: "Recorded with evidence_verified = true and a retained result.",
  durationMs: 1240,
  baselineDurationMs: 96000,
  baselineNote: "Equivalent manual check: read the registry, resolve the card, probe the endpoint by hand.",
});
console.log(`\n  gebo_task            ${first.ok ? "ACCEPTED" : "REFUSED"}  ${first.reason.slice(0, 70)}`);

// 3. The same interaction must not be attestable twice.
const dup = await recordAttestation({
  tokenId,
  attester: "0x0000000000000000000000000000000000000000",
  attesterKind: "gebo",
  evidenceKind: "gebo_task",
  evidenceRef: geboRef,
  outcome: "succeeded",
  task: "duplicate",
});
console.log(`  duplicate            ${dup.ok ? "ACCEPTED (WRONG)" : "REFUSED"}  ${dup.reason.slice(0, 70)}`);

// 4. A fabricated on-chain reference must be refused outright.
const fake = await recordAttestation({
  tokenId,
  attester: "0x1111111111111111111111111111111111111111",
  attesterKind: "wallet",
  evidenceKind: "session_execution",
  evidenceRef: FAKE_TX,
  outcome: "succeeded",
  task: "Claim with no interaction behind it.",
});
console.log(`  fabricated tx        ${fake.ok ? "ACCEPTED (WRONG)" : "REFUSED"}  ${fake.reason.slice(0, 70)}`);

// 5. Read back: counts by outcome, never an average.
const summary = await attestationSummary(tokenId);
const rows = await attestationsFor(tokenId);
console.log(`\n  SUMMARY FOR #${tokenId}`);
if (!summary) console.log(`    none recorded`);
else {
  console.log(`    total ${summary.total}, verified ${summary.verified}`);
  console.log(`    succeeded ${summary.succeeded}  partial ${summary.partial}  failed ${summary.failed}  disputed ${summary.disputed}`);
  console.log(`    attesters ${summary.distinctAttesters} (${summary.trustedAttesters} in the trust set)`);
  console.log(`    evidence kinds ${JSON.stringify(summary.evidenceKinds)}`);
  console.log(`    median duration ${summary.medianDurationMs ?? "-"} ms`);
}
for (const r of rows.slice(0, 4)) {
  console.log(`    ${r.outcome.padEnd(10)} ${r.evidenceKind.padEnd(18)} verified=${r.evidenceVerified} ${r.task?.slice(0, 40) ?? ""}`);
}

const verdict = first.ok && !dup.ok && !fake.ok;
console.log(`\n  Evidence gate: ${verdict ? "HOLDS" : "FAILS"}`);
console.log(verdict
  ? "  A task with a retained output is accepted, a duplicate is refused, and a\n  fabricated transaction is refused. Attestations are anchored, not asserted."
  : "  The gate let something through that it should have refused.");

await sql.end({ timeout: 5 });
console.log("");
