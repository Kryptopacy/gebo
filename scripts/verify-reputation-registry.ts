import "dotenv/config";
import { createPublicClient, http, fallback, parseAbi } from "viem";
import { bsc, bscTestnet } from "viem/chains";

const REP = {
  56: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  97: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
} as const;

const abi = parseAbi([
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

for (const [id, chain] of [[56, bsc], [97, bscTestnet]] as const) {
  const pub = createPublicClient({
    chain,
    transport: fallback((id === 56
      ? [process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com", "https://binance.llamarpc.com"]
      : [process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com"]
    ).map((u) => http(u, { timeout: 15000 }))),
  });
  const addr = REP[id as 56 | 97] as `0x${string}`;
  const code = await pub.getBytecode({ address: addr }).catch(() => undefined);
  console.log(`\n  chain ${id}  ReputationRegistry ${addr}`);
  console.log(`    code: ${code && code !== "0x" ? ((code.length - 2) / 2) + " bytes" : "NONE"}`);
  // A live contract should answer getSummary, even if the count is zero.
  try {
    const r = await pub.readContract({
      address: addr, abi, functionName: "getSummary",
      args: [1n, ["0x0000000000000000000000000000000000000001"], "", ""],
    });
    console.log(`    getSummary responds: ${JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
  } catch (e: any) {
    console.log(`    getSummary: ${String(e?.shortMessage ?? e?.message).slice(0, 90)}`);
  }
}
