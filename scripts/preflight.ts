/**
 * Pre-flight for the Altana session spike, plus recent cron health.
 *
 * Checks the testnet wallet is funded and reports pg_net responses by minute, so
 * historical 401s from before a secret rotation are not mistaken for current
 * failures.
 */
import "dotenv/config";
import { createPublicClient, http, formatEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import postgres from "postgres";

const pk = process.env.DEMO_OWNER_PRIVATE_KEY as `0x${string}` | undefined;
console.log("\n  BNB TESTNET WALLET");
if (!pk) {
  console.log("    DEMO_OWNER_PRIVATE_KEY missing");
} else {
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({
    chain: bscTestnet,
    transport: http(process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com", { timeout: 20_000 }),
  });
  const bal = await pub.getBalance({ address: account.address });
  const nonce = await pub.getTransactionCount({ address: account.address });
  console.log(`    address   ${account.address}`);
  console.log(`    balance   ${formatEther(bal)} tBNB`);
  console.log(`    nonce     ${nonce}`);
  console.log(`    ready     ${bal > 10n ** 16n ? "yes — enough for the session spike" : "NO — needs more than 0.01 tBNB"}`);
}

const url = process.env.DATABASE_URL;
if (url) {
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const recent = await sql<{ minute: string; status_code: number | null; n: number }[]>`
      select to_char(date_trunc('minute', created), 'HH24:MI') as minute,
             status_code, count(*)::int as n
      from net._http_response
      where created > now() - interval '15 minutes'
      group by 1, 2 order by 1 desc limit 12
    `;
    console.log(`\n  pg_net RESPONSES, LAST 15 MINUTES`);
    if (!recent.length) console.log(`    none yet`);
    for (const r of recent) {
      const verdict = r.status_code === 200 ? "ok" : r.status_code === 401 ? "auth failed" : "";
      console.log(`    ${r.minute}  ${String(r.status_code ?? "null").padEnd(5)} x${String(r.n).padEnd(3)} ${verdict}`);
    }

    const last401 = await sql<{ at: string }[]>`
      select to_char(max(created), 'HH24:MI:SS') as at from net._http_response where status_code = 401
    `;
    const last200 = await sql<{ at: string }[]>`
      select to_char(max(created), 'HH24:MI:SS') as at from net._http_response where status_code = 200
    `;
    console.log(`\n    most recent 401: ${last401[0]?.at ?? "never"}`);
    console.log(`    most recent 200: ${last200[0]?.at ?? "never"}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
console.log("");
