"use client";

/**
 * One-click session revocation, in the product.
 *
 * The Altana track requires that a user can see what their agent may do and
 * REVOKE it inside the product. The page showed the exact call; this component
 * sends it. Same pattern as the hire flow: direct EIP-1193 (window.ethereum)
 * over viem, no wagmi provider tree.
 *
 * The Keystore's revokeKey is gated on onlyKeyOwnerOrValidator, so this works
 * only when the connected wallet IS the wallet being inspected - which is the
 * point: GEBO holds no keys and cannot revoke anyone's session for them. A
 * third party reading someone else's wallet gets the read and the calldata,
 * not a button that pretends.
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

// Inline chain definitions (same reason as HireAction: the viem/chains barrel
// costs ~15s per fresh dev worker on this machine).
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

export function RevokeAction({
  wallet, keyId, chainId,
}: {
  wallet: Address;
  keyId: Hex;
  chainId: ChainId;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [walletFound, setWalletFound] = useState(false);
  const [address, setAddress] = useState<Address | null>(null);
  const [connChain, setConnChain] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [revoked, setRevoked] = useState(false);
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

  const revoke = useCallback(async () => {
    const eth = ethereum();
    if (!eth || !address) return;
    setBusy("send");
    setError(null);
    try {
      const data = encodeFunctionData({
        abi: REVOKE_ABI, functionName: "revokeKey", args: [wallet, keyId],
      });
      const hash = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: KEYSTORE[chainId], data }],
      })) as Hex;
      setTxHash(hash);
      setBusy("wait");
      const pub = createPublicClient({
        chain: chainId === 56 ? BSC : BSC_TESTNET,
        transport: http(chainId === 56 ? "https://bsc-rpc.publicnode.com" : "https://bsc-testnet-rpc.publicnode.com"),
      });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (rc.status !== "success") throw new Error("revokeKey reverted on chain");
      setRevoked(true);
      // Re-read the Keystore so the row flips to INACTIVE from the chain,
      // not from our own optimism about the transaction.
      router.refresh();
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  }, [address, chainId, keyId, router, wallet]);

  if (!mounted) return <span className="t-4">checking for a wallet...</span>;
  if (!walletFound) {
    return <span className="t-4">no browser wallet detected</span>;
  }

  if (!address) {
    return (
      <button onClick={connect} className="cta cta-sm" disabled={busy !== null}>
        Connect owner wallet to revoke
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
      <button onClick={switchChain} className="cta cta-sm" disabled={busy !== null}>
        Switch to chain {chainId} to revoke
      </button>
    );
  }

  if (revoked) {
    return (
      <span style={{ color: "var(--pass)" }}>
        Revoked.{" "}
        {txHash && (
          <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            {txHash.slice(0, 10)}...{txHash.slice(-6)}
          </a>
        )}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button onClick={revoke} className="cta cta-sm" disabled={busy !== null}>
        {busy === "send" ? "Check your wallet - signing..." : busy === "wait" ? "Waiting for the chain..." : "Revoke this key"}
      </button>
      {txHash && busy === "wait" && (
        <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="xs num" style={{ color: "var(--accent)" }}>
          {txHash.slice(0, 10)}...{txHash.slice(-6)}
        </a>
      )}
      {error && <span className="xs" style={{ color: "var(--fail)" }}>{error}</span>}
    </div>
  );
}
