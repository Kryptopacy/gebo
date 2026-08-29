"use client";

/**
 * On-chain hire through APEX (ERC-8183), from the browser, with the user's own
 * wallet. Direct EIP-1193 (window.ethereum) over viem's custom transport - no
 * wagmi provider tree, so the bundle stays clean and every injected BSC wallet
 * (MetaMask, Binance Wallet, Trust, Rabby, OKX) works.
 *
 * THE HONEST FLOW, split by role:
 *   client  (the connected wallet)  createJob -> registerJob -> setBudget -> fund
 *   provider (the agent's owner)    submit
 *   anyone                          settle, once the dispute window closes
 *
 * When the connected wallet IS the provider - our demo key, or an agent owner
 * testing their own listing - the submit and settle steps unlock so the whole
 * lifecycle can be driven from this page. Otherwise the job honestly waits at
 * Funded for the agent, which is what hiring actually looks like.
 *
 * ASCII-only source (Windows-1252 write hazard).
 */
import { useCallback, useEffect, useState } from "react";
import {
  createWalletClient, createPublicClient, custom, http, parseAbi, defineChain,
  type Address, type Hex,
} from "viem";

// Inline BSC chain definitions rather than the "viem/chains" barrel. viem 2.55
// has no per-chain subpath export, and the barrel evaluates ~500 chain modules
// (measured 15s+ per fresh dev worker on this machine - the cause of the hire
// page "navigation keeps timing out"). viem's own bsc/bscTestnet are plain
// defineChain objects with no formatters or serializers, so these are
// equivalent; keep fields in sync with viem/chains/definitions if viem changes.
const BSC = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-rpc.publicnode.com"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://bscscan.com" } },
});
const BSC_TESTNET = defineChain({
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-testnet-rpc.publicnode.com"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://testnet.bscscan.org" } },
});

type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

function ethereum(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as { ethereum?: Eip1193 }).ethereum ?? null;
}

const NETWORKS = {
  56: {
    chain: BSC,
    label: "BNB Smart Chain",
    commerce: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6" as Address,
    router: "0x51895229E12F9876011789B04f8698af06cCD6DA" as Address,
    policy: "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5" as Address,
    explorer: "https://bscscan.com",
    rpc: "https://bsc-rpc.publicnode.com",
  },
  97: {
    chain: BSC_TESTNET,
    label: "BSC Testnet",
    commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE" as Address,
    router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address,
    policy: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as Address,
    explorer: "https://testnet.bscscan.org",
    rpc: "https://bsc-testnet-rpc.publicnode.com",
  },
} as const;

const COMMERCE_ABI = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
  "function jobCounter() view returns (uint256)",
  // getJob returns ONE struct tuple, not eleven flat outputs - flat decoding
  // reads the tuple head offset as a string length and yields garbage numbers
  // that look like an arithmetic bug. Shape proven by scripts/hire-apex.ts.
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
]);
const ROUTER_ABI = parseAbi([
  "function registerJob(uint256 jobId, address policy)",
  "function settle(uint256 jobId, bytes evidence)",
]);
const POLICY_ABI = parseAbi(["function disputeWindow() view returns (uint256)"]);

const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

type Tx = { step: string; hash: Hex };

export function HireAction({
  agentTokenId, agentName, categorySlug, providerAddress,
}: {
  agentTokenId: string;
  agentName: string;
  categorySlug: string;
  providerAddress: string;
}) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [walletFound, setWalletFound] = useState(false);
  const [jobId, setJobId] = useState<bigint | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const net = chainId && chainId in NETWORKS ? NETWORKS[chainId as 56 | 97] : null;
  const isProvider = !!(address && providerAddress && address.toLowerCase() === providerAddress.toLowerCase());

  useEffect(() => {
    // SSR cannot know whether a wallet exists; deciding during render would
    // emit the no-wallet notice on the server and swap it on hydration. Decide
    // once mounted, so the first client paint matches the server HTML.
    setMounted(true);
    const eth = ethereum();
    setWalletFound(!!eth);
    if (!eth) return;
    // Silent restore: eth_accounts never prompts, so a returning client is
    // reconnected without a click. An unprompted eth_requestAccounts on load
    // would be the hostile version of this.
    eth.request({ method: "eth_accounts" })
      .then((accs) => {
        if (Array.isArray(accs) && accs.length) setAddress(accs[0] as Address);
      })
      .catch(() => {});
    eth.request({ method: "eth_chainId" })
      .then((id) => { if (typeof id === "string") setChainId(Number(id)); })
      .catch(() => {});
    if (!eth.on) return;
    const onAccounts = (accs: string[]) => setAddress((accs[0] as Address) ?? null);
    const onChain = (id: Hex) => setChainId(Number(id));
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = ethereum();
    if (!eth) return;
    try {
      setError(null);
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress((accs[0] as Address) ?? null);
      const id = (await eth.request({ method: "eth_chainId" })) as string;
      setChainId(Number(id));
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 140));
    }
  }, []);

  const switchTo = useCallback(async (target: 56 | 97) => {
    const eth = ethereum();
    if (!eth) return;
    const hexId = `0x${target.toString(16)}`;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (e) {
      // Chain not added yet - add it (BSC params are well known).
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: hexId,
            chainName: target === 56 ? "BNB Smart Chain" : "BNB Smart Chain Testnet",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [target === 56 ? "https://bsc-rpc.publicnode.com" : "https://bsc-testnet-rpc.publicnode.com"],
            blockExplorerUrls: [target === 56 ? "https://bscscan.com" : "https://testnet.bscscan.org"],
          }],
        });
      } catch {
        setError(String((e as Error).message ?? e).slice(0, 140));
        return;
      }
    }
    const id = (await eth.request({ method: "eth_chainId" })) as string;
    setChainId(Number(id));
  }, []);

  /** Send a contract write, wait for the receipt, record the hash. Fail loud. */
  const send = useCallback(async (step: string, fn: () => Promise<Hex>) => {
    setBusy(step);
    const hash = await fn();
    setTxs((t) => [...t, { step, hash }]);
    const pub = createPublicClient({ chain: net!.chain, transport: http(net!.rpc) });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (rc.status !== "success") throw new Error(`${step} reverted on chain`);
    return rc;
  }, [net]);

  const hire = useCallback(async () => {
    const eth = ethereum();
    if (!eth || !net || !address) return;
    setBusy("connect");
    setError(null);
    setTxs([]);
    setJobId(null);
    setDone(false);
    try {
      const wallet = createWalletClient({ account: address, chain: net.chain, transport: custom(eth) });
      const pub = createPublicClient({ chain: net.chain, transport: http(net.rpc) });

      const disputeWindow = (await pub.readContract({
        address: net.policy, abi: POLICY_ABI, functionName: "disputeWindow",
      })) as bigint;
      const expiredAt = BigInt(Math.floor(Date.now() / 1000)) + disputeWindow + 3n * 24n * 3600n;
      const description = `GEBO hire: ${agentName} (#${agentTokenId}, ${categorySlug}), zero budget, client ${address.slice(0, 10)}`;

      // 1. createJob - provider is the agent's owner; the connected wallet is the client.
      // jobCounter is read BEFORE and AFTER so our job can be identified even
      // when another client hires concurrently on the shared contract; blindly
      // taking the post-create counter would target their job, and the client
      // checks in setBudget/fund would revert on it loudly but wrongly.
      const pre = (await pub.readContract({
        address: net.commerce, abi: COMMERCE_ABI, functionName: "jobCounter",
      })) as bigint;
      await send("createJob", () => wallet.writeContract({
        address: net.commerce, abi: COMMERCE_ABI, functionName: "createJob",
        args: [providerAddress as Address, net.router, expiredAt, description, net.router],
      }));
      const post = (await pub.readContract({
        address: net.commerce, abi: COMMERCE_ABI, functionName: "jobCounter",
      })) as bigint;
      let id: bigint;
      if (post === pre + 1n) {
        id = post;
      } else {
        let found: bigint | null = null;
        for (let j = post; j > pre; j--) {
          const job = (await pub.readContract({
            address: net.commerce, abi: COMMERCE_ABI, functionName: "getJob", args: [j],
          })) as { client: Address; provider: Address; status: number };
          if (job.client.toLowerCase() === address.toLowerCase() &&
              job.provider.toLowerCase() === providerAddress.toLowerCase() &&
              Number(job.status) === 0) { found = j; break; }
        }
        if (found === null) throw new Error("could not identify this hire among concurrent jobs on the contract");
        id = found;
      }
      setJobId(id);

      // 2. registerJob with the optimistic policy (independent grader, invariant 7).
      await send("registerJob", () => wallet.writeContract({
        address: net.router, abi: ROUTER_ABI, functionName: "registerJob",
        args: [id, net.policy],
      }));

      // 3. setBudget(0) - required even at zero; fund reverts without it.
      await send("setBudget", () => wallet.writeContract({
        address: net.commerce, abi: COMMERCE_ABI, functionName: "setBudget",
        args: [id, 0n, "0x"],
      }));

      // 4. fund(0) - escrow opens. No ERC-20 approve needed at zero budget.
      await send("fund", () => wallet.writeContract({
        address: net.commerce, abi: COMMERCE_ABI, functionName: "fund",
        args: [id, 0n, "0x"],
      }));

      setDone(true);
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  }, [address, net, providerAddress, agentTokenId, agentName, categorySlug, send]);

  /** Provider-only: submit the deliverable. */
  const submit = useCallback(async () => {
    const eth = ethereum();
    if (!eth || !net || !address || jobId === null) return;
    setBusy("submit");
    setError(null);
    try {
      const wallet = createWalletClient({ account: address, chain: net.chain, transport: custom(eth) });
      const { toBytes, keccak256 } = await import("viem");
      const deliverable = keccak256(toBytes(`gebo-${categorySlug}-${jobId}-${Date.now()}`));
      await send("submit", () => wallet.writeContract({
        address: net.commerce, abi: COMMERCE_ABI, functionName: "submit",
        args: [jobId, deliverable, "0x"],
      }));
      setDone(true);
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  }, [address, net, jobId, categorySlug, send]);

  /** Permissionless settle, once the dispute window has closed. */
  const settle = useCallback(async () => {
    const eth = ethereum();
    if (!eth || !net || !address || jobId === null) return;
    setBusy("settle");
    setError(null);
    try {
      const wallet = createWalletClient({ account: address, chain: net.chain, transport: custom(eth) });
      await send("settle", () => wallet.writeContract({
        address: net.router, abi: ROUTER_ABI, functionName: "settle",
        args: [jobId, "0x"],
      }));
      setDone(true);
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  }, [address, net, jobId, send]);

  // ── render ─────────────────────────────────────────────────────────────

  if (!providerAddress) {
    return (
      <div className="notice mt-m" data-tone="fail">
        This agent has no owner address on record, so there is no provider to enter
        escrow with. A hire without a counterparty is not a hire.
      </div>
    );
  }

  if (!mounted) {
    return <div className="notice mt-m">Checking for a browser wallet...</div>;
  }

  if (!walletFound) {
    return (
      <div className="notice mt-m">
        No browser wallet detected. Install MetaMask, Binance Wallet or Trust Wallet to hire on chain.
      </div>
    );
  }

  if (!address) {
    return (
      <button onClick={connect} className="cta" style={{ width: "100%", padding: "14px 0", marginTop: 12 }}>
        Connect wallet to hire
      </button>
    );
  }

  if (!net) {
    return (
      <div className="notice mt-m" data-tone="fail">
        <div>Connected wallet is on an unsupported network (chain {chainId}).</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={() => switchTo(56)} className="cta" style={{ padding: "8px 14px" }}>Switch to BSC</button>
          <button onClick={() => switchTo(97)} className="cta" style={{ padding: "8px 14px" }}>Switch to Testnet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-m">
      <dl className="spec">
        <div>
          <dt>Client</dt>
          <dd className="num xs">{address}</dd>
        </div>
        <div>
          <dt>Provider (the agent)</dt>
          <dd className="num xs">
            {providerAddress}
            {isProvider && <span className="xs t-4"> - that is this wallet, so you can submit and settle too</span>}
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd className="num xs">{net.label}</dd>
        </div>
        {jobId !== null && (
          <div>
            <dt>Job</dt>
            <dd className="num xs">#{jobId.toString()}</dd>
          </div>
        )}
      </dl>

      {txs.length > 0 && (
        <div className="stack-sm mt-m">
          {txs.map((t, i) => (
            <div key={i} className="xs num">
              <span className={busy === t.step ? "" : "t-3"}>{t.step}</span>
              {" - "}
              <a href={`${net.explorer}/tx/${t.hash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                {t.hash.slice(0, 10)}...{t.hash.slice(-6)}
              </a>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="notice mt-m" data-tone="fail">
          <span className="sm">{error}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={hire}
          disabled={busy !== null}
          className="cta"
          style={{ flex: 1, padding: "12px 0" }}
        >
          {busy === "connect" || busy === "createJob" || busy === "registerJob" || busy === "setBudget" || busy === "fund"
            ? "Signing - check your wallet..."
            : jobId === null ? "Hire on chain (zero budget)" : "Hire again"}
        </button>
        {jobId !== null && isProvider && (
          <button
            onClick={submit}
            disabled={busy !== null}
            className="cta"
            style={{ flex: 1, padding: "12px 0" }}
          >
            {busy === "submit" ? "Signing submit..." : "Submit deliverable"}
          </button>
        )}
        {jobId !== null && (
          <button
            onClick={settle}
            disabled={busy !== null}
            className="cta"
            style={{ flex: 1, padding: "12px 0", opacity: busy ? 0.5 : 1 }}
          >
            {busy === "settle" ? "Signing settle..." : "Settle"}
          </button>
        )}
      </div>

      {jobId !== null && !done && busy === null && (
        <p className="xs t-4" style={{ marginTop: 10 }}>
          Escrow is open. The agent submits its deliverable as the provider; settle becomes
          possible for anyone once the dispute window ({net.chain.id === 56 ? "7 days" : "15 minutes"}) closes.
        </p>
      )}

      {done && busy === null && (
        <p className="xs" style={{ marginTop: 10, color: "var(--pass)" }}>
          On chain. View the job at{" "}
          <a href={`${net.explorer}/address/${net.commerce}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            the APEX contract
          </a>{" "}
          or revoke authority anytime from{" "}
          <a href="/authority" style={{ color: "var(--accent)" }}>the authority console</a>.
        </p>
      )}

      <p className="xs t-4" style={{ marginTop: 10 }}>
        Zero budget by design: the job traverses the identical Open - Funded - Submitted - Completed
        state machine with only the two safeTransfer calls skipped. Cost is gas only.
      </p>
    </div>
  );
}
