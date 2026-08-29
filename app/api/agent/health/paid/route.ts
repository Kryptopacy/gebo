/**
 * x402/B402 sell side for the reference health agent — the Altana track's
 * bonus, built with @altananetwork/x402-server rather than by hand.
 *
 * One guard in front of the same computation the free A2A endpoint serves:
 * a request without a valid payment gets the 402 challenge; a request with
 * one gets the health report plus the settlement receipt. The challenge
 * offers the EIP-3009 $U rail, which is what BNB Agent Studio buyers sign,
 * so `bag x402 buy`, Altana's fetchWithX402, and any B402 v2 client can pay.
 *
 * The free endpoint stays: the registry's probes must never pay to measure,
 * and a liveness check that costs money would quietly stop happening.
 *
 * TESTNET (97) deliberately: the facilitator EOA is the same demo owner key
 * the regrant cron uses, and it holds tBNB, not BNB. Earnings land on payTo;
 * the facilitator only pays gas and can never redirect funds - the recipient
 * is bound into the buyer's signature.
 */
import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { isAddress, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { createX402Merchant, U_TOKEN, type PaymentReceipt } from "@altananetwork/x402-server";
import { healthFactorFor, summarise } from "@/lib/venus";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/** 0.01 $U per call, clamped to [0.005, 0.1]. 18 decimals, like $U itself. */
const PRICE = 10_000_000_000_000_000n;
const MIN_PRICE = 5_000_000_000_000_000n;
const MAX_PRICE = 100_000_000_000_000_000n;

type Merchant = Awaited<ReturnType<typeof createX402Merchant>>;
let merchantPromise: Promise<Merchant> | null = null;

function getMerchant(): Promise<Merchant> {
  merchantPromise ??= (async () => {
      const pk = process.env.DEMO_OWNER_PRIVATE_KEY;
      if (!pk) throw new Error("DEMO_OWNER_PRIVATE_KEY not configured");
      const facilitator = privateKeyToAccount(pk as `0x${string}`);
      // Earnings land on a dedicated receive-only address (X402_PAY_TO), NOT
      // the facilitator: the facilitator pays gas and could be any funded
      // key, while payTo is bound into the buyer's signature. When both were
      // the demo key, the settlement became a self-transfer - mechanically
      // correct, financially a circle. Separate the roles properly.
      const payTo = (process.env.X402_PAY_TO ?? facilitator.address) as Address;
      const siteBase =
        process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.VERCEL_PROJECT_PRODUCTION_URL ??
        "http://localhost:3100";
      const resource = new URL(
        "/api/agent/health/paid",
        siteBase.startsWith("http") ? siteBase : `https://${siteBase}`,
      ).href;
      return createX402Merchant({
        chainId: 97,
        payTo,
        price: PRICE,
        minPrice: MIN_PRICE,
        maxPrice: MAX_PRICE,
        // Both rails: eip3009 $U is what BNB Agent Studio buyers sign;
        // permit2-exact is what Altana smart-account (session key) buyers
        // sign — the eip3009 rail rejects session signatures with
        // "Invalid signature", verified live during the end-to-end test.
        rails: [
          { rail: "eip3009", token: U_TOKEN[97] },
          { rail: "permit2-exact", token: U_TOKEN[97], spender: facilitator.address },
        ],
        facilitator,
        rpcUrl: process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
        chain: bscTestnet,
        resource,
        description:
          "GEBO HealthGuard reference agent: Venus lending health factor for a BNB Chain address, " +
          "computed from per-market collateral, oracle prices and collateral factors.",
        maxTimeoutSeconds: 300,
      });
    })();
  return merchantPromise;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: "Pass ?address=0x... — the BNB Chain address whose Venus health factor you are buying." },
      { status: 400 },
    );
  }

  let m: Awaited<ReturnType<typeof getMerchant>>;
  try {
    m = await getMerchant();
  } catch (err) {
    return NextResponse.json(
      { error: `Paid endpoint not configured: ${String((err as Error).message).slice(0, 120)}` },
      { status: 503 },
    );
  }

  const { response, receipt } = await m.guard(request);
  if (response) return response; // 402 challenge or a rejection with its reason

  // Paid. Compute and answer, carrying the settlement receipt so the buyer
  // can verify where their money went.
  const started = Date.now();
  try {
    const report = await healthFactorFor(address as Address);
    return NextResponse.json({
      paid: receiptSummary(receipt!),
      answer: {
        text: summarise(report),
        account: report.account,
        blockNumber: report.blockNumber.toString(),
        healthFactor: report.healthFactor,
        verdict: report.verdict,
        borrowingPowerUsd: report.borrowingPowerUsd,
        totalBorrowedUsd: report.totalBorrowedUsd,
        totalSuppliedUsd: report.totalSuppliedUsd,
        liquidityUsd: report.liquidityUsd,
        shortfallUsd: report.shortfallUsd,
        marketsEntered: report.positions.length,
        computedInMs: Date.now() - started,
        qualifiers: {
          source: "Venus Comptroller and per-market getAccountSnapshot, read at the block above",
          liquidatableAtOrBelow: 1,
        },
      },
    });
  } catch (err) {
    // The payment settled but the work failed; say so rather than emitting a
    // plausible number. The receipt is still included - the buyer paid, and
    // hiding that would be worse than the failure itself.
    return NextResponse.json(
      {
        paid: receiptSummary(receipt!),
        error: `Payment accepted but the read failed: ${String((err as Error).message).slice(0, 160)}`,
      },
      { status: 502 },
    );
  }
}

function receiptSummary(r: PaymentReceipt) {
  return {
    txHash: r.txHash,
    payer: r.payer,
    amount: (Number(r.amount) / 1e18).toFixed(4) + " $U",
    rail: r.rail,
    chainId: 97,
  };
}
