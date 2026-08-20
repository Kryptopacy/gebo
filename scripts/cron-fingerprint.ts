/**
 * Compare the Vault cron secret against the one configured in the app, without
 * revealing either.
 *
 * Prints a short SHA-256 prefix and the length. Hash the Vercel value locally
 * with the command this prints; matching fingerprints mean the secrets agree.
 *
 * Fingerprinting rather than printing exists because an earlier session leaked a
 * live secret into a chat transcript. Never print the value.
 */
import "dotenv/config";
import postgres from "postgres";
import { createHash } from "node:crypto";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [r] = await sql<{ secret: string | null; site: string | null }[]>`
    select public.gebo_secret('gebo_cron_secret') as secret,
           public.gebo_secret('gebo_site_url')    as site
  `;

  if (!r?.secret) {
    console.log(`\n  gebo_cron_secret is not present in Vault.\n`);
    process.exit(0);
  }

  const raw = r.secret;
  const trimmed = raw.trim();
  const fp = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

  console.log(`\n  VAULT gebo_cron_secret`);
  console.log(`    length              ${raw.length}`);
  console.log(`    fingerprint         ${fp(raw)}`);

  if (raw !== trimmed) {
    console.log(`    ⚠ has surrounding whitespace — length would be ${trimmed.length} trimmed`);
    console.log(`    fingerprint trimmed ${fp(trimmed)}`);
    console.log(`\n    Whitespace is the most common cause of a 401 here. Re-create the`);
    console.log(`    secret without it:`);
    console.log(`      select vault.update_secret(`);
    console.log(`        (select id from vault.secrets where name = 'gebo_cron_secret'),`);
    console.log(`        '<value with no spaces or newline>');`);
  }

  console.log(`\n  VAULT gebo_site_url`);
  console.log(`    value               ${r.site ?? "(missing)"}`);
  if (r.site && r.site.endsWith("/")) {
    console.log(`    ⚠ trailing slash produces a double slash in the request path`);
  }
  if (r.site && !r.site.startsWith("https://")) {
    console.log(`    ⚠ should start with https://`);
  }

  console.log(`\n  Compare with the value configured in Vercel — run locally:`);
  console.log(`\n    node -e "console.log(require('crypto').createHash('sha256').update(process.env.CRON_SECRET,'utf8').digest('hex').slice(0,16))"`);
  console.log(`\n  ...with CRON_SECRET set to the Vercel value. Matching fingerprints`);
  console.log(`  mean the two agree and the 401 lies elsewhere.\n`);
} catch (e: any) {
  console.error(`\n  FAILED: ${String(e?.message ?? e).slice(0, 240)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
