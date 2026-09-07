"use client";

/**
 * Global kill switch: revoke every active session key in one action.
 *
 * The spec's authority-console requirement is "a global kill switch that
 * revokes every session in one batch" (PRODUCT_SPEC); ranked user demand #7
 * was one-click revocation of everything. The Keystore ABI exposes one
 * revokeKey(user, keyId) per key - there is no batch function on the
 * registry contract, and inventing an ABI is how addresses get burned. So
 * "one action" is implemented honestly: one click fans out into sequential
 * revokeKey transactions from the connected owner wallet, with per-key
 * progress and links, stopping on the first failure rather than pretending.
 *
 * Same trust boundary as RevokeAction: the Keystore accepts revocation only
 * from the key owner or its validator, so this works only when the connected
 * wallet IS the wallet being inspected. GEBO holds no keys and cannot revoke
 * for anyone.
 *
 * ASCII-only source (Windows-1252 write hazard).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPublicClient, http, parseAbi, encodeFunctionData, defineChain,
  type Address, type Hex,
} from "viem";
import { KEYSTORE, type ChainId } from "@/lib/keystore";

const BSC = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-rpc.publicnode.com"] } },
});
const BSC_TESTNET = defineChain({
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-testnet-rpc.publicnode.com"] } },
});

const REVOKE_ABI = parseAbi([
  "function revokeKey(address user, bytes32 keyId)",
]);

type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

function ethereum(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as { ethereum?: Eip1193 }).ethereum ?? null;
}

export function RevokeAllAction({
  wallet, keyIds, chainId,
}: {
  wallet: Address;
  /** Active keys only - already-inactive keys need no revocation. */
  keyIds: Hex[];
  chainId: ChainId;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [walletFound, setWalletFound] = useState(false);
  const [address, setAddress] = useState<Address | null>(null);
  const [connChain, setConnChain] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [txs, setTxs] = useState<Hex[]>([]);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const eth = ethereum();
    setWalletFound(!!eth);
    if (!eth) return;
    eth.request({ method: "eth_accounts" })
      .then((accs) => { if (Array.isArray(accs) && accs.length) setAddress(accs[0] as Address); })
      .catch(() => {});
    eth.request({ method: "eth_chainId" })
      .then((id) => { if (typeof id === "string") setConnChain(Number(id)); })
      .catch(() => {});
    if (!eth.on) return;
    const onAccounts = (accs: string[]) => setAddress((accs[0] as Address) ?? null);
    const onChain = (id: Hex) => setConnChain(Number(id));
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const explorer = chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.org";
  const isOwner = !!(address && address.toLowerCase() === wallet.toLowerCase());
  const chainMatches = connChain === chainId;

  const connect = useCallback(async () => {
    const eth = ethereum();
    if (!eth) return;
    try {
      setError(null);
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress((accs[0] as Address) ?? null);
      const id = (await eth.request({ method: "eth_chainId" })) as string;
      setConnChain(Number(id));
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 140));
    }
  }, []);

  const switchChain = useCallback(async () => {
    const eth = ethereum();
    if (!eth) return;
    const hexId = `0x${chainId.toString(16)}`;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (e) {
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: hexId,
            chainName: chainId === 56 ? "BNB Smart Chain" : "BNB Smart Chain Testnet",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [chainId === 56 ? "https://bsc-rpc.publicnode.com" : "https://bsc-testnet-rpc.publicnode.com"],
            blockExplorerUrls: [explorer],
          }],
        });
      } catch {
        setError(String((e as Error).message ?? e).slice(0, 140));
        return;
      }
    }
    const id = (await eth.request({ method: "eth_chainId" })) as string;
    setConnChain(Number(id));
  }, [chainId, explorer]);

  /**
   * Sequential, not parallel: each revokeKey is its own transaction and the
   * wallet prompts once per key. A failure stops the run and names the key
   * it stopped on - half-revoked with visible progress is recoverable;
   * racing transactions with a hidden failure count is not.
   */
  const revokeAll = useCallback(async () => {
    const eth = ethereum();
    if (!eth || !address) return;
    setBusy(true);
    setError(null);
    let ok = 0;
    for (const keyId of keyIds) {
      try {
        const data = encodeFunctionData({
          abi: REVOKE_ABI, functionName: "revokeKey", args: [wallet, keyId],
        });
        const hash = (await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: address, to: KEYSTORE[chainId], data }],
        })) as Hex;
        setTxs((t) => [...t, hash]);
        const pub = createPublicClient({
          chain: chainId === 56 ? BSC : BSC_TESTNET,
          transport: http(chainId === 56 ? "https://bsc-rpc.publicnode.com" : "https://bsc-testnet-rpc.publicnode.com"),
        });
        const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
        if (rc.status !== "success") throw new Error(`revokeKey reverted on chain for ${keyId.slice(0, 18)}...`);
        ok++;
        setDone(ok);
      } catch (e) {
        setError(
          `Stopped after ${ok} of ${keyIds.length} - ${String((e as Error).message ?? e).slice(0, 140)}. ` +
          `The remaining keys are still active; retry to continue.`,
        );
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setFinished(true);
    // Re-read the Keystore so the table flips to INACTIVE from the chain,
    // not from our optimism about the transactions.
    router.refresh();
  }, [address, chainId, keyIds, router, wallet]);

  if (!mounted) return <span className="t-4">checking for a wallet...</span>;
  if (!walletFound) {
    return <span className="t-4">no browser wallet detected</span>;
  }
  if (!address) {
    return (
      <button onClick={connect} className="cta cta-sm" disabled={busy}>
        Connect owner wallet to revoke all
      </button>
    );
  }
  if (!isOwner) {
    return (
      <span className="t-4">
        Connected wallet is not this wallet. The Keystore accepts revocation only
        from the key owner or its validator - connect {wallet.slice(0, 10)}...{wallet.slice(-6)}.
      </span>
    );
  }
  if (!chainMatches) {
    return (
      <button onClick={switchChain} className="cta cta-sm" disabled={busy}>
        Switch to chain {chainId} to revoke all
      </button>
    );
  }

  if (finished) {
    return (
      <span style={{ color: "var(--pass)" }}>
        All {keyIds.length} key{keyIds.length === 1 ? "" : "s"} revoked.{" "}
        {txs.length > 0 && (
          <a href={`${explorer}/tx/${txs[txs.length - 1]}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            last tx {txs[txs.length - 1]!.slice(0, 10)}...{txs[txs.length - 1]!.slice(-6)}
          </a>
        )}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        onClick={revokeAll}
        className="cta cta-sm"
        disabled={busy}
        style={busy ? undefined : { background: "var(--fail)", borderColor: "var(--fail)" }}
      >
        {busy
          ? `Revoking ${done} of ${keyIds.length}...`
          : `Revoke all ${keyIds.length} active key${keyIds.length === 1 ? "" : "s"}`}
      </button>
      <span className="xs t-4">
        {busy
          ? "Confirm each transaction in your wallet - one per key, sequential."
          : "One click, one transaction per key. A revoked key cannot be reinstated."}
      </span>
      {error && <span className="xs" style={{ color: "var(--fail)" }}>{error}</span>}
    </div>
  );
}
