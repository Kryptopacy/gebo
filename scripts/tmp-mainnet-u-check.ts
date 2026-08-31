/**
 * Resolve the mainnet $U acquisition question (AGENTS.md "Verified reviews"):
 * does a PancakeSwap V2/V3 pool exist for APEX's mainnet payment token ($U)?
 *
 * Method: query the V2 pair factory and the V3 pool factory for $U/WBNB and
 * $U/USDT. Positive controls run first - WBNB/USDT must resolve to a real,
 * liquid pool - so a zero address for $U means "no pool exists", not "wrong
 * factory address". Any $U pool found also gets its reserves/liquidity read,
 * because a dust pool is not an acquisition path.
 */
import "dotenv/config";
import { createPublicClient, http, fallback, parseAbi, formatUnits, getAddress, type Address } from "viem";
import { bsc } from "viem/chains";

const U = getAddress("0xce24439f2d9c6a2289f741120fe202248b666666");
const WBNB = getAddress("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c");
const USDT = getAddress("0x55d398326f99059ff775485246999027b3197955");
const V2_FACTORY = getAddress("0xca143ce32fe78f1f7019d7d551a6402fc5350c73");
const V3_FACTORY = getAddress("0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865");
const ZERO = "0x0000000000000000000000000000000000000000";
const V3_FEES = [100, 500, 2500, 10000];

const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const V2F = parseAbi(["function getPair(address tokenA, address tokenB) view returns (address pair)"]);
const V3F = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)"]);
const PAIR = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
]);
const POOL = parseAbi([
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
]);

const pub = createPublicClient({
  chain: bsc,
  transport: fallback(
    [process.env.BSC_MAINNET_RPC, "https://bsc-rpc.publicnode.com", "https://binance.llamarpc.com"]
      .filter(Boolean)
      .map((u) => http(u as string, { timeout: 25_000, retryCount: 2 })),
  ),
});

async function v2Check(a: Address, b: Address, label: string): Promise<void> {
  const pair = (await pub.readContract({ address: V2_FACTORY, abi: V2F, functionName: "getPair", args: [a, b] })) as Address;
  if (pair === ZERO) {
    console.log(`  V2 ${label}: no pair`);
    return;
  }
  const [r0, r1] = (await pub.readContract({ address: pair, abi: PAIR, functionName: "getReserves" })) as [bigint, bigint, number];
  console.log(`  V2 ${label}: ${pair} reserves ${formatUnits(r0, 18)} / ${formatUnits(r1, 18)}`);
}

async function v3Check(a: Address, b: Address, fee: number, label: string): Promise<void> {
  const pool = (await pub.readContract({ address: V3_FACTORY, abi: V3F, functionName: "getPool", args: [a, b, fee] })) as Address;
  if (pool === ZERO) {
    console.log(`  V3 ${label} (${fee / 10000}%): no pool`);
    return;
  }
  const liq = (await pub.readContract({ address: pool, abi: POOL, functionName: "liquidity" })) as bigint;
  // token balances held by the pool are the ground truth on usable depth
  const balA = (await pub.readContract({ address: a, abi: ERC20, functionName: "balanceOf", args: [pool] })) as bigint;
  const balB = (await pub.readContract({ address: b, abi: ERC20, functionName: "balanceOf", args: [pool] })) as bigint;
  console.log(`  V3 ${label} (${fee / 10000}%): ${pool} liquidity ${formatUnits(liq, 18)} balances ${formatUnits(balA, 18)} / ${formatUnits(balB, 18)}`);
}

const block = await pub.getBlockNumber();
console.log(`mainnet (56) at block ${block}\n`);

console.log("$U token sanity:");
const symbol = await pub.readContract({ address: U, abi: ERC20, functionName: "symbol" });
const decimals = await pub.readContract({ address: U, abi: ERC20, functionName: "decimals" });
const supply = await pub.readContract({ address: U, abi: ERC20, functionName: "totalSupply" });
console.log(`  symbol ${symbol}, decimals ${decimals}, totalSupply ${formatUnits(supply, Number(decimals))}\n`);

console.log("factory controls (WBNB/USDT must resolve and be liquid):");
await v2Check(WBNB, USDT, "WBNB/USDT");
await v3Check(WBNB, USDT, 100, "WBNB/USDT");
console.log("");

console.log("$U pools:");
for (const other of [WBNB, USDT]) {
  await v2Check(U, other, `$U/${other === WBNB ? "WBNB" : "USDT"}`);
  for (const fee of V3_FEES) {
    await v3Check(U, other, fee, `$U/${other === WBNB ? "WBNB" : "USDT"}`);
  }
}
