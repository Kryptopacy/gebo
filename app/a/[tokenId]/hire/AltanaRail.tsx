"use client";

/**
 * Rail 2 of the hire flow: the ERC-8183 hire through the Altana SDK itself,
 * in the product - not only from the script.
 *
 * The SDK's relay layer accepts a raw private key (server/CLI) or a passkey
 * (browser); injected EIP-1193 signers are rejected by SDK 0.8.0. So the
 * in-product SDK rail is a passkey wallet: the user's browser creates an
 * Altana smart-account wallet keyed to their device, and every intent - the
 * hire included - is one atomic relay batch signed by that key. The key never
 * leaves the device and GEBO never sees it, which is the custody property the
 * Altana track is actually about.
 *
 * Zero budget, by the same deliberate policy as the direct rail: the job
 * traverses the identical escrow state machine, and cost is recorded as a
 * true zero rather than implied value transfer.
 *
 * TESTNET (97) deliberately: the testnet relay serves chain 97, the faucet
 * path exists there, and the Altana demo stack is testnet by decision.
 *
 * The SDK is imported dynamically on first use so porto/ox stay out of the
 * page's initial bundle.
 *
 * ASCII-only source (Windows-1252 write hazard).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient, createClient as viemCreateClient, http, parseAbi,
  parseEther, formatEther, defineChain,
  type Address, type Hex,
} from "viem";
import type { Client, CreateWalletResult } from "@altananetwork/sdk";

const BSC_TESTNET = defineChain({
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-testnet-rpc.publicnode.com"] } },
});

const RPC = "https://bsc-testnet-rpc.publicnode.com";
const EXPLORER = "https://testnet.bscscan.org";
const STORAGE_KEY = "gebo.altana.wallet";

/**
 * The SDK registry's TESTNET policy (0x4F4678D4..., 24h dispute window)
 * reverts in registerJob with PolicyNotWhitelisted on the router that
 * accepts the 15-minute deployment (0xd6a42175...). Every GEBO testnet hire
 * binds the 15-minute policy so the Open -> Funded -> Submitted -> Completed
 * cycle finishes inside a demo. Verified in scripts/hire-altana-sdk.ts.
 */
const POLICY_OVERRIDE_97 = "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as Address;

type Sdk = typeof import("@altananetwork/sdk");

type HireOutcome = {
  jobId: string;
  status: string;
  rail: string;
  tx?: Hex;
};

export function AltanaRail({
  agentTokenId, agentName, categorySlug, providerAddress,
}: {
  agentTokenId: string;
  agentName: string;
  categorySlug: string;
  providerAddress: string | null;
}) {
  const sdkRef = useRef<Sdk | null>(null);
  const clientRef = useRef<Client | null>(null);
  const [wallet, setWallet] = useState<CreateWalletResult | null>(null);
  const [lastAddress, setLastAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<HireOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passkeyOk, setPasskeyOk] = useState(true);

  useEffect(() => {
    // localStorage is client-only; reading during render would mismatch SSR.
    try { setLastAddress(window.localStorage.getItem(STORAGE_KEY)); } catch {}
    setPasskeyOk(typeof window !== "undefined" && !!window.PublicKeyCredential);
  }, []);

  const pushLog = useCallback((line: string) => {
    setLog((l) => [...l, line]);
  }, []);

  const loadSdk = useCallback(async (): Promise<Sdk> => {
    sdkRef.current ??= await import("@altananetwork/sdk");
    return sdkRef.current;
  }, []);

  const ensureClient = useCallback((sdk: Sdk): Client => {
    clientRef.current ??= sdk.createClient({ chains: [sdk.BNB_TESTNET] });
    return clientRef.current;
  }, []);

  const refreshBalance = useCallback(async (address: Address) => {
    try {
      const pub = createPublicClient({ chain: BSC_TESTNET, transport: http(RPC) });
      const wei = await pub.getBalance({ address });
      setBalance(`${Number(formatEther(wei)).toFixed(4)} tBNB`);
    } catch {
      // A failed balance read is not a failed wallet; render unmeasured.
      setBalance(null);
    }
  }, []);

  const createWallet = useCallback(async () => {
    setBusy("create"); setError(null); setLog([]); setResult(null);
    try {
      const sdk = await loadSdk();
      const client = ensureClient(sdk);
      pushLog("your browser will ask for a passkey - that key is the wallet, and it never leaves this device");
      const w = await client.createPasskeyWallet({ name: "GEBO" });
      setWallet(w);
      try { window.localStorage.setItem(STORAGE_KEY, w.address); } catch {}
      setLastAddress(w.address);
      pushLog(`wallet ready: ${w.address} (EIP-7702 smart account on chain 97)`);
      await refreshBalance(w.address as Address);
    } catch (e) {
      setError(String((e as Error)?.message ?? e).slice(0, 300));
    } finally {
      setBusy(null);
    }
  }, [ensureClient, loadSdk, pushLog, refreshBalance]);

  const recoverWallet = useCallback(async () => {
    setBusy("recover"); setError(null); setLog([]); setResult(null);
    try {
      const sdk = await loadSdk();
      const client = ensureClient(sdk);
      pushLog("pick the passkey you created this wallet with");
      const w = await client.recoverFromPasskey();
      setWallet(w);
      try { window.localStorage.setItem(STORAGE_KEY, w.address); } catch {}
      setLastAddress(w.address);
      await refreshBalance(w.address as Address);
    } catch (e) {
      setError(String((e as Error)?.message ?? e).slice(0, 300));
    } finally {
      setBusy(null);
    }
  }, [ensureClient, loadSdk, pushLog, refreshBalance]);

  const faucet = useCallback(async () => {
    if (!wallet) return;
    setBusy("faucet"); setError(null);
    try {
      const sdk = await loadSdk();
      const relay = viemCreateClient({
        chain: BSC_TESTNET,
        transport: http(sdk.TESTNET_RELAY_URL, { timeout: 60_000 }),
      });
      // The cast bridges the SDK's over-narrowed client type (its d.ts bakes
      // in one concrete chain instantiation) to this structurally identical
      // client. Runtime behaviour is unaffected: it is an HTTP client pointed
      // at the relay URL either way.
      const r = await sdk.fundNative(
        relay as Parameters<typeof sdk.fundNative>[0],
        wallet.address as Address,
        parseEther("0.05"),
      );
      if (r.transactionHash) pushLog(`faucet tx ${r.transactionHash.slice(0, 10)}...`);
      await refreshBalance(wallet.address as Address);
    } catch (e) {
      setError(String((e as Error)?.message ?? e).slice(0, 300));
    } finally {
      setBusy(null);
    }
  }, [wallet, loadSdk, pushLog, refreshBalance]);

  const hire = useCallback(async () => {
    if (!wallet || !providerAddress) return;
    setBusy("hire"); setError(null); setLog([]); setResult(null);
    try {
      const sdk = await loadSdk();
      const client = ensureClient(sdk);
      const task =
        `GEBO hire: ${agentName} (#${agentTokenId}, ${categorySlug}), zero budget, ` +
        `client ${wallet.address.slice(0, 10)}`;
      pushLog("submitting one atomic relay intent: createJob, registerJob, setBudget, approve, fund");

      let outcome: HireOutcome;
      try {
        const r = await sdk.hireErc8183Agent(
          wallet,
          wallet.signer,
          { provider: providerAddress as Address, task, budget: 0n },
          { network: sdk.BNB_TESTNET },
        );
        outcome = {
          jobId: r.jobId.toString(),
          status: r.status,
          rail: "hireErc8183Agent (Altana SDK)",
          tx: r.transactionHash,
        };
      } catch (err: unknown) {
        const details = String((err as { details?: string })?.details ?? "");
        if (details !== "0xc94463e3") throw err;
        pushLog("SDK default policy not whitelisted on this router; retrying with the 15-minute policy");
        const addrs = { ...sdk.erc8183Addresses(97), policy: POLICY_OVERRIDE_97 };
        const pub = createPublicClient({ transport: http(RPC, { timeout: 30_000 }) });
        const counter = await pub.readContract({
          address: addrs.commerce,
          abi: parseAbi(["function jobCounter() view returns (uint256)"]),
          functionName: "jobCounter",
        });
        const window = await pub.readContract({
          address: addrs.policy,
          abi: parseAbi(["function disputeWindow() view returns (uint256)"]),
          functionName: "disputeWindow",
        });
        const calls = sdk.buildHireCalls({
          addresses: addrs,
          jobId: counter + 1n,
          provider: providerAddress as Address,
          description: task,
          budget: 0n,
          expiredAt: BigInt(Math.floor(Date.now() / 1000)) + window + 1800n,
        });
        const r = await client.execute({
          wallet, signer: wallet.signer, calls, chainId: 97,
        });
        outcome = {
          jobId: (counter + 1n).toString(),
          status: r.status,
          rail: "client.execute(buildHireCalls) (Altana SDK)",
          tx: r.transactionHash,
        };
      }

      // Confirm on chain the way a third party would, not by trusting the
      // relay's own report.
      pushLog("verifying the job on chain...");
      const job = await sdk.getErc8183Job(sdk.BNB_TESTNET, BigInt(outcome.jobId));
      outcome = { ...outcome, status: job.statusName };
      setResult(outcome);
    } catch (e) {
      setError(String((e as Error)?.message ?? e).slice(0, 300));
    } finally {
      setBusy(null);
    }
  }, [wallet, providerAddress, agentTokenId, agentName, categorySlug, ensureClient, loadSdk, pushLog]);

  if (!providerAddress) {
    return (
      <div className="notice mt-m" data-tone="fail">
        No provider address on record for this agent, so the SDK rail has no counterparty.
      </div>
    );
  }

  return (
    <div className="surface-card-tight mt-m">
      <p className="section-label">Rail 2 - Altana SDK (ERC-8183 buyer side, testnet 97)</p>
      <p className="prose sm" style={{ marginBottom: 0 }}>
        A passkey wallet created in your browser signs one atomic relay intent -
        createJob, registerJob, setBudget, approve and fund batched by Altana&apos;s relay.
        The key never leaves your device and GEBO never sees it. Zero budget by the
        same policy as the direct rail: the escrow state machine is identical and
        cost is a true zero.
      </p>

      {!passkeyOk && (
        <div className="notice mt-m" data-tone="fail">
          This browser does not expose WebAuthn, so it cannot create or hold a
          passkey wallet. Use the direct rail above, or a browser with passkey support.
        </div>
      )}

      {!wallet ? (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={createWallet} className="cta" disabled={busy !== null || !passkeyOk}>
            {busy === "create" ? "Waiting for your passkey..." : "Create an Altana wallet (passkey)"}
          </button>
          {lastAddress && (
            <button onClick={recoverWallet} className="cta" disabled={busy !== null || !passkeyOk}>
              {busy === "recover" ? "Waiting for your passkey..." : `Recover ${lastAddress.slice(0, 8)}...`}
            </button>
          )}
        </div>
      ) : (
        <>
          <dl className="spec mt-m">
            <div>
              <dt>Altana wallet</dt>
              <dd className="num xs">{wallet.address}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd className="num xs">
                {balance ?? "unmeasured"}
                {balance !== null && Number(balance.split(" ")[0]) < 0.005 && (
                  <>
                    {" - "}
                    <button onClick={faucet} className="link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }} disabled={busy !== null}>
                      {busy === "faucet" ? "requesting tBNB..." : "get tBNB from the relay faucet"}
                    </button>
                  </>
                )}
              </dd>
            </div>
          </dl>
          <button onClick={hire} className="cta" style={{ width: "100%", padding: "12px 0", marginTop: 12 }} disabled={busy !== null}>
            {busy === "hire" ? "Signing - check your browser..." : "Hire via the Altana relay (zero budget)"}
          </button>
        </>
      )}

      {log.length > 0 && (
        <div className="stack-sm mt-m" style={{ gap: 4 }}>
          {log.map((line, i) => (
            <div key={i} className="xs t-4 num">{line}</div>
          ))}
        </div>
      )}

      {result && (
        <div className="notice mt-m">
          <strong>Job #{result.jobId} on chain.</strong>{" "}
          <span className="sm">
            Status {result.status}, via {result.rail}
            {result.tx && (
              <>
                {" - "}
                <a href={`${EXPLORER}/tx/${result.tx}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                  {result.tx.slice(0, 10)}...{result.tx.slice(-6)}
                </a>
              </>
            )}
            . Verified with the SDK&apos;s own read, the same one a third party would run.
          </span>
        </div>
      )}

      {error && (
        <div className="notice mt-m" data-tone="fail">
          <span className="sm">{error}</span>
        </div>
      )}
    </div>
  );
}
