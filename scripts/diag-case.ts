import "dotenv/config";
import { createClient as createAltanaClient, BNB_TESTNET, signerFromPrivateKey } from "@altananetwork/sdk";
import { parseAbi, encodeFunctionData, type Address, type Hex } from "viem";

const WBNB_CHECKSUM = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const WBNB_LOWER = "0xae13d989dac2f0debff460ac112a837c89baa7cd" as Address;
const SPENDER = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as Address;

const client = createAltanaClient({ chains: [BNB_TESTNET] });
const signer = signerFromPrivateKey(process.env.DEMO_OWNER_PRIVATE_KEY as Hex);
const wallet = await client.createWallet({ signer });

const data = encodeFunctionData({
  abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
  functionName: "approve", args: [SPENDER, 1n],
});

const reason = (e: any) => {
  const h = [e?.message, e?.details, e?.cause?.message].filter(Boolean).join(" | ");
  return h.match(/Reason:\s*(\w+)/)?.[1] ?? String(e?.shortMessage ?? e?.message).slice(0, 70);
};

// Byte-exactness hypothesis: does the validator match the token address raw?
for (const [label, addr] of [["lowercase", WBNB_LOWER], ["checksummed", WBNB_CHECKSUM]] as const) {
  try {
    const s = await client.grantSession({
      wallet, signer,
      permissions: {
        calls: [{ to: addr, signature: "approve(address,uint256)" }],
        spend: [{ limit: 10n ** 18n, period: "day", token: addr }],
      },
      expiry: Math.floor(Date.now() / 1000) + 900,
    });
    try {
      const r = await client.execute({ session: s, calls: [{ to: addr, data }] });
      console.log(`  ALLOWED  token ${label}  ${(r as any)?.transactionHash ?? ""}`);
    } catch (e: any) {
      console.log(`  REFUSED  token ${label}  ${reason(e)}`);
    }
    await client.revokeSession({ wallet, signer, session: s }).catch(() => {});
  } catch (e: any) {
    console.log(`  GRANT FAILED  ${label}  ${reason(e)}`);
  }
}
