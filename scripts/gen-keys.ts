/**
 * Generate the testnet wallet set described in docs/STRATEGY.md §8.
 *
 * SAFETY: these keys are written to .env in plaintext and must be treated as
 * PUBLIC. They must never derive or share a mnemonic with any mainnet key.
 *
 * Only fills placeholders that are currently empty — never overwrites.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENV = ".env";

const SLOTS = [
  { key: "DEV_PRIVATE_KEY", role: "Dev / deployer — pays gas during development" },
  { key: "DEMO_OWNER_PRIVATE_KEY", role: "Demo owner — the 'user' who grants & revokes sessions" },
  { key: "REPUTATION_WRITER_PRIVATE_KEY", role: "Reputation writer — PUBLIC identity, do not rotate" },
] as const;

if (!existsSync(ENV)) {
  console.error(`${ENV} not found. Run from the project root.`);
  process.exit(1);
}

let env = readFileSync(ENV, "utf8");
const results: { role: string; key: string; address: string; created: boolean }[] = [];

for (const slot of SLOTS) {
  const re = new RegExp(`^${slot.key}=(.*)$`, "m");
  const match = env.match(re);

  if (match && match[1] && match[1].trim() !== "") {
    const existing = match[1].trim() as `0x${string}`;
    results.push({
      role: slot.role,
      key: slot.key,
      address: privateKeyToAccount(existing).address,
      created: false,
    });
    continue;
  }

  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;

  if (match) {
    env = env.replace(re, `${slot.key}=${pk}`);
  } else {
    env += `\n${slot.key}=${pk}\n`;
  }

  results.push({ role: slot.role, key: slot.key, address, created: true });
}

writeFileSync(ENV, env, "utf8");

console.log("\n  BSC TESTNET WALLETS (chain 97)");
console.log("  " + "-".repeat(74));
for (const r of results) {
  console.log(`  ${r.created ? "NEW    " : "EXISTS "} ${r.key}`);
  console.log(`           ${r.role}`);
  console.log(`           ${r.address}`);
  console.log("");
}
console.log("  " + "-".repeat(74));
console.log("  FUND THIS ADDRESS to run the Altana spike:");
console.log(`     ${results.find((r) => r.key === "DEMO_OWNER_PRIVATE_KEY")!.address}`);
console.log("  Faucet: https://testnet.bnbchain.org/faucet-smart");
console.log("  Need ~0.05 tBNB. The dev wallet can stay empty for the spike.\n");
console.log("  These keys are in .env (gitignored) and are TESTNET-ONLY.");
console.log("  Treat them as public. Never reuse on mainnet.\n");
