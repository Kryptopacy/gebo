/**
 * Pre-publicity secret audit. Checks, WITHOUT ever printing a value:
 *   1. no .env-like file is tracked by git now
 *   2. every secret-ish value in the local .env has never been committed
 *      (git log --all -S scan)
 *   3. no tracked file in the working tree contains a raw 64-hex private key
 *      or common secret token prefixes
 * Prints only variable names and commit counts.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e: any) {
    return "";
  }
}

// 1. tracked env files
const tracked = git(["ls-files"]);
const trackedFiles = tracked.split("\n").filter(Boolean);
const envTracked = trackedFiles.filter((f) => /^\.env($|\.)/.test(f) || f.endsWith(".pem") || f.endsWith(".key"));
console.log(`tracked env/key files: ${envTracked.length ? envTracked.join(", ") : "none"}`);

// 2. history scan of every .env value
if (existsSync(".env")) {
  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  let checked = 0;
  const hits: string[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (!m) continue;
    const [, name, raw] = m;
    let value = raw.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    // strip trailing inline comments used in .env.example-style files
    value = value.split(/\s+#/)[0]!.trim();
    if (value.length < 8) continue; // too short to be a secret worth scanning
    checked++;
    const out = git(["log", "--all", "--oneline", "-S", value]);
    if (out) {
      const n = out.split("\n").length;
      hits.push(`${name}: ${n} commit(s)`);
    }
  }
  console.log(`env values scanned against full history: ${checked}`);
  console.log(hits.length ? `HISTORY HITS (value appears in commits):\n  ${hits.join("\n  ")}` : "history hits: none");
} else {
  console.log("no local .env found");
}

// 3. working-tree scan of tracked files
const patterns: [string, RegExp][] = [
  ["raw 64-hex key", /\b0x[0-9a-fA-F]{64}\b/],
  ["openai-style key", /\bsk-[A-Za-z0-9]{20,}\b/],
  ["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["supabase service key", /\beyJ[A-Za-z0-9_-]{40,}\.eyJ/],
];
const textFiles = trackedFiles.filter((f) => /\.(ts|tsx|js|mjs|json|sql|md|txt|css|yml|yaml|env|sh)$/.test(f) || f === ".env.example" || f.startsWith(".github"));
const treeHits: string[] = [];
for (const f of textFiles) {
  let content = "";
  try { content = readFileSync(f, "utf8"); } catch { continue; }
  for (const [label, re] of patterns) {
    const m = content.match(re);
    if (m) treeHits.push(`${f}: ${label}`);
  }
}
console.log(`tracked text files scanned: ${textFiles.length}`);
console.log(treeHits.length ? `WORKING-TREE HITS:\n  ${treeHits.join("\n  ")}` : "working-tree hits: none");
