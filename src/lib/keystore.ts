/**
 * Read agent authority from the Altana Keystore.
 *
 * The Altana track requires that a user can see what their agent may do and
 * revoke it inside the product. Reads make that possible for ANY wallet without
 * permission: Altana documents this as "a plain read against the public Keystore,
 * so it needs no admin key, no session, and nothing from Altana".
 *
 * Verified on both networks. Mainnet keystore 0x6572427E..., testnet
 * 0x6b8361C2... - different addresses, which is easy to get wrong.
 *
 * WHAT CANNOT BE READ. The Keystore exposes getKeys, getPublicKey and
 * isValidKey. It exposes no getter for `metadata`, `validator` or `expiry`, which
 * are the fields carrying the permission set - they are arguments to registerKey.
 * So the precise allowlist and spend caps of a third party's session are not
 * readable from the registry alone, and this module says so rather than implying
 * a scope it cannot see.
 */
import { createPublicClient, http, fallback, parseAbi, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";

export const KEYSTORE = {
  56: "0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a",
  97: "0x6b8361C29d05D498b1a12B54A37310f94171E94A",
} as const satisfies Record<number, Address>;

export const KEYSTORE_CONTROLLER = {
  56: "0x0834Ee2C9BdC3E3efF0a2dC34393D4B0e546A555",
  97: "0xb530D1971f5453F3359518343F05D0AedFfF7e12",
} as const satisfies Record<number, Address>;

export type ChainId = 56 | 97;

const abi = parseAbi([
  "function getKeys(address user) view returns (bytes32[])",
  "function getPublicKey(address user, bytes32 keyId) view returns (bytes)",
  "function isValidKey(address user, bytes32 keyId) view returns (bool)",
]);

const RPC: Record<ChainId, string[]> = {
  56: [
    process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com",
    "https://binance.llamarpc.com",
    "https://bsc-dataseed1.bnbchain.org",
  ],
  97: [
    process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
    "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
  ],
};

function client(chainId: ChainId): PublicClient {
  return createPublicClient({
    chain: chainId === 56 ? bsc : bscTestnet,
    transport: fallback(RPC[chainId].map((u) => http(u, { timeout: 12_000, retryCount: 1 }))),
    batch: { multicall: { wait: 20, batchSize: 200 } },
  }) as PublicClient;
}

export type SessionKey = {
  keyId: Hex;
  publicKey: Hex | null;
  /** Live on-chain validity. False means expired or revoked. */
  valid: boolean;
  /** True when keccak256(publicKey) equals the keyId, per the v0 convention. */
  keyIdMatchesPublicKey: boolean;
};

export type WalletAuthority = {
  chainId: ChainId;
  wallet: Address;
  keystore: Address;
  /** Whether the account has been deployed or upgraded yet. */
  deployed: boolean;
  /** EIP-7702 delegation target, when the account delegates. */
  delegatesTo: Address | null;
  keys: SessionKey[];
  activeKeys: number;
  blockNumber: string;
  readAt: string;
  error: string | null;
};

export async function readAuthority(wallet: Address, chainId: ChainId = 56): Promise<WalletAuthority> {
  const readAt = new Date().toISOString();
  const keystore = KEYSTORE[chainId] as Address;
  const base: WalletAuthority = {
    chainId, wallet, keystore,
    deployed: false, delegatesTo: null,
    keys: [], activeKeys: 0,
    blockNumber: "0", readAt, error: null,
  };

  try {
    const pub = client(chainId);
    const [blockNumber, code, keyIds] = await Promise.all([
      pub.getBlockNumber(),
      pub.getBytecode({ address: wallet }).catch(() => undefined),
      pub.readContract({ address: keystore, abi, functionName: "getKeys", args: [wallet] })
        .catch(() => [] as readonly Hex[]) as Promise<readonly Hex[]>,
    ]);

    // An EIP-7702 account carries a delegation indicator: 0xef0100 ‖ address.
    let delegatesTo: Address | null = null;
    if (code && code.startsWith("0xef0100") && code.length >= 48) {
      delegatesTo = (`0x${code.slice(8, 48)}`) as Address;
    }

    const keys: SessionKey[] = [];
    if (keyIds.length) {
      const [valids, pubs] = await Promise.all([
        pub.multicall({
          contracts: keyIds.map((k) => ({ address: keystore, abi, functionName: "isValidKey" as const, args: [wallet, k] })),
          allowFailure: true,
        }),
        pub.multicall({
          contracts: keyIds.map((k) => ({ address: keystore, abi, functionName: "getPublicKey" as const, args: [wallet, k] })),
          allowFailure: true,
        }),
      ]);

      for (let i = 0; i < keyIds.length; i++) {
        const keyId = keyIds[i]!;
        const valid = valids[i]?.status === "success" ? Boolean(valids[i]!.result) : false;
        const publicKey = pubs[i]?.status === "success" ? (pubs[i]!.result as Hex) : null;
        keys.push({
          keyId,
          publicKey,
          valid,
          keyIdMatchesPublicKey: publicKey ? keccak256(publicKey).toLowerCase() === keyId.toLowerCase() : false,
        });
      }
    }

    return {
      ...base,
      deployed: !!code && code !== "0x",
      delegatesTo,
      keys,
      activeKeys: keys.filter((k) => k.valid).length,
      blockNumber: blockNumber.toString(),
    };
  } catch (err: any) {
    return { ...base, error: String(err?.shortMessage ?? err?.message ?? err).slice(0, 200) };
  }
}

/** Is this a syntactically valid address? Cheap guard before an RPC round trip. */
export function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/**
 * The exact call a user signs to revoke, for display.
 *
 * Revocation is gated on the key owner or validator, so the product cannot
 * perform it on a user's behalf without their admin key - and GEBO holds no
 * keys. Showing the precise call is the honest alternative: it is verifiable,
 * copyable, and independent of us.
 */
export function revokeCall(wallet: Address, keyId: Hex, chainId: ChainId = 56) {
  return {
    to: KEYSTORE[chainId] as Address,
    signature: "revokeKey(address user, bytes32 keyId)",
    args: [wallet, keyId] as const,
    note: "Immediate and monotonic. A revoked key cannot be reinstated.",
  };
}
