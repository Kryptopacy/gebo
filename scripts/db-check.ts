/**
 * Validate and test the database connection.
 *
 * Prints structural facts only — never the password, never the full URI.
 * A previous session leaked a secret by dumping .env; that must not recur.
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("\n  DATABASE_URL is not set.\n");
  process.exit(1);
}

let u: URL;
try {
  u = new URL(url);
} catch {
  console.error("\n  DATABASE_URL is not a parseable URI.\n");
  process.exit(1);
}

const checks: { label: string; ok: boolean; detail: string; fatal: boolean }[] = [];

checks.push({
  label: "scheme",
  ok: u.protocol === "postgresql:" || u.protocol === "postgres:",
  detail: u.protocol,
  fatal: true,
});

const hasBrackets = /[[\]]/.test(url);
checks.push({
  label: "no placeholder brackets",
  ok: !hasBrackets,
  detail: hasBrackets ? "found [ or ] — dashboard placeholder left in place" : "clean",
  fatal: true,
});

const isPooler = u.hostname.includes("pooler.supabase.com");
checks.push({
  label: "pooler host",
  ok: isPooler,
  detail: u.hostname,
  fatal: false,
});

checks.push({
  label: "transaction port 6543",
  ok: u.port === "6543",
  detail: u.port || "(default)",
  fatal: false,
});

// Pooler requires the username to carry the project ref: postgres.<ref>
const userHasRef = /^postgres\.[a-z0-9]+$/.test(decodeURIComponent(u.username));
checks.push({
  label: "user carries project ref",
  ok: userHasRef || !isPooler,
  detail: decodeURIComponent(u.username).replace(/^(postgres\.?)(.{0,6}).*$/, "$1$2…"),
  fatal: false,
});

checks.push({
  label: "password present",
  ok: u.password.length > 0,
  detail: `${u.password.length} chars`,
  fatal: true,
});

checks.push({ label: "database", ok: u.pathname.length > 1, detail: u.pathname.slice(1), fatal: true });

console.log("\n  DATABASE_URL structure");
console.log("  " + "-".repeat(66));
for (const c of checks) {
  console.log(`  ${c.ok ? "ok  " : c.fatal ? "FAIL" : "warn"}  ${c.label.padEnd(28)} ${c.detail}`);
}

if (checks.some((c) => !c.ok && c.fatal)) {
  console.error("\n  Fatal problems above. Not attempting to connect.\n");
  process.exit(1);
}

console.log("\n  connecting…");
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 });

try {
  const [ver] = await sql<{ version: string }[]>`select version()`;
  const [db] = await sql<{ d: string; u: string }[]>`select current_database() as d, current_user as u`;
  const tables = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.tables where table_schema = 'public'
  `;
  console.log(`  ok    server                       ${ver!.version.split(" ").slice(0, 2).join(" ")}`);
  console.log(`  ok    database / role              ${db!.d} / ${db!.u}`);
  console.log(`  ok    public tables                ${tables[0]!.n}`);
  console.log("\n  CONNECTION OK\n");
} catch (e: any) {
  console.error(`\n  CONNECTION FAILED: ${String(e?.message ?? e).slice(0, 240)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
