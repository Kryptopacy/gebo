import "dotenv/config";
import { simulateSwap, simulateVenusSupply } from "../src/lib/simulate.ts";

const a = await simulateSwap("USDT", "WBNB", "250");
console.log(`  swap  ok=${a.ok} block=${a.block}`);
console.log(`  ${a.headline}`);
if (a.error) console.log(`  error: ${a.error}`);
console.log(`  gas estimate: ${a.gasEstimate}`);
for (const n of a.notes) console.log(`    - ${n}`);
for (const d of a.deltas) console.log(`    ${d.direction === "out" ? "-" : "+"} ${d.amount}`);

const b = await simulateVenusSupply("USDT", "1000");
console.log(`\n  venus ok=${b.ok}`);
console.log(`  ${b.headline}`);
if (b.error) console.log(`  error: ${b.error}`);
