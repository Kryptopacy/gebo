import "dotenv/config";
import { humanReason } from "../src/lib/liveness.ts";

// The exact strings that leaked into the human-facing column.
const cases: [string, string | null, string | null][] = [
  ["DORMANT", "http_5xx", '{"type":"https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-502/","'],
  ["DORMANT", "other", "23"],
  ["LISTED",  "ok", "2xx but no MCP initialize result"],
  ["DORMANT", "dns", "getaddrinfo ENOTFOUND agent.example.org"],
  ["DORMANT", "timeout", "The operation was aborted due to timeout"],
  ["VERIFIED", "ok", null],
  ["SHADOWED", null, "template_var in https://x/agents/{agentId}/card"],
  ["DORMANT", "http_4xx", "Not Found"],
  ["DORMANT", null, null],
];

console.log("\n  REASON COLUMN, BEFORE AND AFTER\n");
for (const [to, cls, detail] of cases) {
  const before = detail ?? cls ?? "-";
  console.log(`  raw:   ${String(before).slice(0, 78)}`);
  console.log(`  shown: ${humanReason(to, cls, detail)}`);
  console.log("");
}
