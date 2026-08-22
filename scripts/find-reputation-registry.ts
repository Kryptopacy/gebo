/**
 * Locate the ERC-8004 Reputation Registry on BNB Smart Chain.
 *
 * The Identity Registry is known (0x8004a169...a432, read from every agent's
 * contract_address). The Reputation Registry is a sibling contract and its
 * address must not be guessed - probing vanity prefixes found nothing, and
 * writing feedback to the wrong contract would be irreversible.
 *
 * Strategy, most authoritative first:
 *   1. 8004scan's chain record, which may carry per-chain contract addresses
 *   2. a real feedback row, which may carry the transaction that created it
 *   3. failing both, the transaction's `to` address is definitive
 */
import "dotenv/config";

const BASE = process.env.EIGHT004SCAN_BASE_URL ?? "https://8004scan.io/api/v1/public";
const KEY = process.env.EIGHT004SCAN_API_KEY;

const headers: Record<string, string> = { accept: "application/json" };
if (KEY) headers["X-API-Key"] = KEY;

async function get(path: string): Promise<{ status: number; body: any }> {
  try {
    const r = await fetch(BASE + path, { headers, signal: AbortSignal.timeout(25_000) });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e: any) {
    return { status: 0, body: { error: String(e?.message ?? e).slice(0, 120) } };
  }
}

function addressesIn(obj: unknown, path = "", out: [string, string][] = []): [string, string][] {
  if (obj == null) return out;
  if (typeof obj === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(obj)) out.push([path || "(root)", obj]);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.slice(0, 6).forEach((v, i) => addressesIn(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      addressesIn(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

console.log("");

// 1. Chain record.
const chains = await get("/chains");
const list: any[] = Array.isArray(chains.body?.data)
  ? chains.body.data
  : Array.isArray(chains.body?.data?.chains)
    ? chains.body.data.chains
    : [];
const bsc = list.find((c) => Number(c?.chain_id ?? c?.chainId) === 56);

console.log(`  /chains  status ${chains.status}, ${list.length} chain record(s)`);
if (bsc) {
  const found = addressesIn(bsc);
  if (found.length) {
    console.log(`  addresses in the chain-56 record:`);
    for (const [k, v] of found) console.log(`    ${k.padEnd(30)} ${v}`);
  } else {
    console.log(`  chain-56 record carries no contract addresses`);
    console.log(`  keys: ${Object.keys(bsc).join(", ").slice(0, 160)}`);
  }
} else {
  console.log(`  no chain-56 record; top-level keys: ${Object.keys(chains.body ?? {}).join(", ")}`);
}

// 2. A real feedback row.
const fb = await get("/feedbacks?chainId=56&limit=3");
const rows: any[] = Array.isArray(fb.body?.data) ? fb.body.data : [];
console.log(`\n  /feedbacks  status ${fb.status}, ${rows.length} row(s)`);
if (rows.length) {
  console.log(`  fields: ${Object.keys(rows[0]).join(", ").slice(0, 200)}`);
  const found = addressesIn(rows[0]);
  for (const [k, v] of found) console.log(`    ${k.padEnd(30)} ${v}`);
  const txish = Object.entries(rows[0]).find(([k]) => /tx|hash|transaction/i.test(k));
  if (txish) console.log(`    tx field: ${txish[0]} = ${String(txish[1]).slice(0, 70)}`);
} else {
  console.log(`  body: ${JSON.stringify(fb.body).slice(0, 200)}`);
}

// 3. Agent detail sometimes carries richer contract context than the list view.
const detail = await get("/agents/56/96231");
if (detail.body?.data) {
  const found = addressesIn(detail.body.data).filter(([k]) => /contract|registry|reputation|validation/i.test(k));
  if (found.length) {
    console.log(`\n  agent detail, registry-shaped fields:`);
    for (const [k, v] of found) console.log(`    ${k.padEnd(30)} ${v}`);
  }
}

console.log("");
