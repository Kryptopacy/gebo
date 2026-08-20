/**
 * Session scope: spend caps, contract allowlists, and blast-radius computation.
 *
 * THE DECIMALS FOOTGUN. Altana's own documentation warns that the same
 * stablecoin uses 6 decimals on Ethereum and 18 on BNB Chain, so
 * "100 USDT/day" is `100n * 10n ** 18n` here. Getting this wrong is not a
 * rounding error — it is a 10^12 mistake in the direction of granting an agent
 * a trillion times the intended authority. Every cap in GEBO is therefore built
 * by one function, `spendCap()`, with the decimals looked up from a table rather
 * than assumed.
 *
 * Session objects must also be byte-exact when executed: Altana matches the
 * grant commitment, and "sloppy JSON round-trips (bigints to numbers, key
 * reordering) break the match". Hence canonicalise() rather than JSON.stringify.
 */
import type { Address } from "viem";

/** BNB Chain token decimals. Verified per token — never defaulted to 18. */
export const TOKENS: Record<string, { address: Address; decimals: number; symbol: string; label: string }> = {
  USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, symbol: "USDT", label: "Tether USD" },
  USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, symbol: "USDC", label: "USD Coin" },
  BUSD: { address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18, symbol: "BUSD", label: "Binance USD" },
  WBNB: { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, symbol: "WBNB", label: "Wrapped BNB" },
  CAKE: { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, symbol: "CAKE", label: "PancakeSwap" },
  BTCB: { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18, symbol: "BTCB", label: "Bitcoin BEP20" },
  ETH:  { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18, symbol: "ETH", label: "Ethereum" },
};

/** Contracts an agent may be scoped to, with the risk each call carries. */
export const CONTRACTS: Record<string, { address: Address; label: string; note: string }> = {
  PCS_SMART_ROUTER: {
    address: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
    label: "PancakeSwap SmartRouter",
    note: "Routes across V3, V2 and StableSwap. Required for any swap.",
  },
  PCS_POSITION_MANAGER: {
    address: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    label: "PancakeSwap NonfungiblePositionManager",
    note: "Mints, adjusts and burns concentrated-liquidity positions.",
  },
  PCS_MASTERCHEF_V3: {
    address: "0x556B9306565093C855AEA9AE92A594704c2Cd59e",
    label: "PancakeSwap MasterChefV3",
    note: "Custodies farmed LP NFTs. Needed only if the position is staked.",
  },
  VENUS_COMPTROLLER: {
    address: "0xfD36E2c2a6789Db23113685031d7F16329158384",
    label: "Venus Comptroller",
    note: "Enters and exits markets; does not move funds by itself.",
  },
};

/**
 * Function selectors an agent may be granted, annotated by what they can do.
 * Scoping to a contract alone is insufficient — `approve` on a router is far
 * more dangerous than `exactInputSingle`, and users deserve to see which.
 */
export const SELECTORS: Record<string, { signature: string; risk: "read" | "move" | "approve"; note: string }> = {
  exactInputSingle:  { signature: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))", risk: "move", note: "Swap an exact input amount through one pool." },
  exactInput:        { signature: "exactInput((bytes,address,uint256,uint256))", risk: "move", note: "Swap along a multi-hop route." },
  mint:              { signature: "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))", risk: "move", note: "Open a new liquidity position." },
  increaseLiquidity: { signature: "increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))", risk: "move", note: "Add to an existing position." },
  decreaseLiquidity: { signature: "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))", risk: "move", note: "Withdraw from a position." },
  collect:           { signature: "collect((uint256,address,uint128,uint128))", risk: "move", note: "Claim accrued fees." },
  approve:           { signature: "approve(address,uint256)", risk: "approve", note: "Grant a third party spending rights. Far broader than a single swap." },
};

export type SpendPermission = {
  token: Address | null;
  limit: bigint;
  period: "hour" | "day" | "week";
  /** Retained so the UI can render the cap without re-deriving decimals. */
  decimals: number;
  humanAmount: string;
  symbol: string;
};

export type CallPermission = { to?: Address; signature?: string };

export type SessionPermissions = {
  calls: CallPermission[];
  spend: SpendPermission[];
};

/**
 * The ONLY place a spend cap is constructed.
 *
 * Rejects unknown tokens rather than defaulting to 18 decimals, because a wrong
 * default here is indistinguishable from a correct value until funds move.
 */
export function spendCap(
  symbol: string,
  humanAmount: string,
  period: SpendPermission["period"],
): SpendPermission {
  const token = TOKENS[symbol];
  if (!token) {
    throw new Error(`spendCap: unknown token "${symbol}" — refusing to guess its decimals`);
  }
  if (!/^\d+(\.\d+)?$/.test(humanAmount)) {
    throw new Error(`spendCap: "${humanAmount}" is not a plain decimal amount`);
  }

  const [whole = "0", frac = ""] = humanAmount.split(".");
  if (frac.length > token.decimals) {
    throw new Error(`spendCap: ${humanAmount} has more precision than ${symbol} supports (${token.decimals} decimals)`);
  }
  const padded = frac.padEnd(token.decimals, "0");
  const limit = BigInt(whole) * 10n ** BigInt(token.decimals) + BigInt(padded || "0");

  return { token: token.address, limit, period, decimals: token.decimals, humanAmount, symbol };
}

/** Inverse of spendCap, for rendering a stored cap back to human form. */
export function formatCap(cap: SpendPermission): string {
  const base = 10n ** BigInt(cap.decimals);
  const whole = cap.limit / base;
  const frac = cap.limit % base;
  if (frac === 0n) return `${whole} ${cap.symbol}`;
  const s = frac.toString().padStart(cap.decimals, "0").replace(/0+$/, "");
  return `${whole}.${s} ${cap.symbol}`;
}

// ── presets ────────────────────────────────────────────────────────────────

export type ScopePreset = {
  id: string;
  name: string;
  summary: string;
  contracts: string[];
  selectors: string[];
  caps: { symbol: string; amount: string; period: SpendPermission["period"] }[];
  expiryHours: number;
};

export const PRESETS: Record<string, ScopePreset[]> = {
  rebalancing: [
    {
      id: "conservative",
      name: "Conservative",
      summary: "Adjust one position, small gas budget, expires in a day.",
      contracts: ["PCS_POSITION_MANAGER"],
      selectors: ["decreaseLiquidity", "collect", "increaseLiquidity"],
      caps: [{ symbol: "WBNB", amount: "0.02", period: "day" }],
      expiryHours: 24,
    },
    {
      id: "standard",
      name: "Standard",
      summary: "Re-range positions and swap to rebalance. Expires in a week.",
      contracts: ["PCS_POSITION_MANAGER", "PCS_SMART_ROUTER"],
      selectors: ["decreaseLiquidity", "collect", "mint", "increaseLiquidity", "exactInputSingle"],
      caps: [
        { symbol: "USDT", amount: "250", period: "day" },
        { symbol: "WBNB", amount: "0.05", period: "day" },
      ],
      expiryHours: 168,
    },
  ],
  grid: [
    {
      id: "conservative",
      name: "Conservative",
      summary: "Single-pool swaps only, tight daily cap, one day.",
      contracts: ["PCS_SMART_ROUTER"],
      selectors: ["exactInputSingle"],
      caps: [{ symbol: "USDT", amount: "100", period: "day" }],
      expiryHours: 24,
    },
    {
      id: "standard",
      name: "Standard",
      summary: "Routed swaps with a larger cap, one week.",
      contracts: ["PCS_SMART_ROUTER"],
      selectors: ["exactInputSingle", "exactInput"],
      caps: [{ symbol: "USDT", amount: "500", period: "day" }],
      expiryHours: 168,
    },
  ],
  yield: [
    {
      id: "conservative",
      name: "Conservative",
      summary: "Enter and exit Venus markets, no swapping, one day.",
      contracts: ["VENUS_COMPTROLLER"],
      selectors: [],
      caps: [{ symbol: "USDT", amount: "200", period: "day" }],
      expiryHours: 24,
    },
    {
      id: "standard",
      name: "Standard",
      summary: "Move capital between venues, swapping where required.",
      contracts: ["VENUS_COMPTROLLER", "PCS_SMART_ROUTER"],
      selectors: ["exactInputSingle"],
      caps: [{ symbol: "USDT", amount: "1000", period: "day" }],
      expiryHours: 168,
    },
  ],
  health: [
    {
      id: "conservative",
      name: "Watch only",
      summary: "No spending authority at all. The agent can only observe.",
      contracts: [],
      selectors: [],
      caps: [],
      expiryHours: 720,
    },
    {
      id: "standard",
      name: "Defend the position",
      summary: "Repay debt to restore health factor. Cannot withdraw collateral.",
      contracts: ["VENUS_COMPTROLLER"],
      selectors: [],
      caps: [{ symbol: "USDT", amount: "500", period: "day" }],
      expiryHours: 720,
    },
  ],
};

// ── blast radius ───────────────────────────────────────────────────────────

export type BlastRadius = {
  unbounded: boolean;
  contracts: { address: Address; label: string; note: string }[];
  selectors: { signature: string; risk: string; note: string }[];
  caps: SpendPermission[];
  expiresInHours: number;
  /** Null when unbounded — an honest refusal beats a fabricated ceiling. */
  worstCase: string | null;
  warnings: string[];
};

export function buildPermissions(preset: ScopePreset): SessionPermissions {
  const calls: CallPermission[] = [];

  /**
   * Target-only rules, verified on BNB testnet.
   *
   * An earlier version emitted `{ to, signature }` pairs, which looks tighter but
   * authorises nothing: every execute failed with NoSpendPermissions. Altana's
   * own DEX guide uses `{ to: router }` alone, and that is what the validator
   * matches. Spike transaction 0x06be3407dc746356… is the first call that
   * succeeded after switching to this shape.
   *
   * Narrowing is still real, and comes from two independent dimensions:
   *   calls  restricts WHICH contracts may be touched
   *   spend  restricts WHICH tokens may leave, and how much per period
   *
   * Verified separately: a target-only rule permits calling WBNB, yet moving
   * WBNB out is still refused when the cap covers native only. Selector-level
   * detail is retained on the preset for display, because users deserve to see
   * which functions an agent intends to call even though the validator scopes by
   * contract.
   */
  for (const c of preset.contracts) {
    const contract = CONTRACTS[c];
    if (contract) calls.push({ to: contract.address });
  }

  return { calls, spend: preset.caps.map((c) => spendCap(c.symbol, c.amount, c.period)) };
}

export function blastRadius(preset: ScopePreset): BlastRadius {
  const perms = buildPermissions(preset);
  const warnings: string[] = [];

  // Altana: omitting `calls` means the session may call ANY contract within its
  // spend cap. That is a real configuration, so it must be surfaced loudly
  // rather than treated as an impossible state.
  const unbounded = perms.calls.length === 0 && perms.spend.length > 0;
  if (unbounded) {
    warnings.push(
      "No contract allowlist. Within its spend cap this session could call any contract on BNB Chain, including ones that did not exist when it was granted.",
    );
  }

  if (preset.selectors.includes("approve")) {
    warnings.push(
      "This agent intends to call approve(). That grants a third party ongoing spending rights which outlive any single transaction. Note that the session scopes by contract, not by function, so an allowlisted contract can be called in other ways too.",
    );
  }

  /**
   * A scope with no spend cap cannot move value, verified on testnet: a
   * target-only rule permits the call but an uncapped token is still refused.
   * Worth stating positively rather than leaving the field empty.
   */
  if (preset.caps.length === 0 && preset.contracts.length > 0) {
    warnings.push(
      "No spend cap is granted, so this session cannot move tokens or native value even on the contracts it may call.",
    );
  }

  if (preset.contracts.includes("PCS_MASTERCHEF_V3")) {
    warnings.push(
      "Includes MasterChefV3, which custodies farmed LP NFTs. Necessary only if the position is staked.",
    );
  }

  if (preset.expiryHours > 336) {
    warnings.push(`Long expiry (${Math.round(preset.expiryHours / 24)} days). Shorter sessions limit exposure if the agent is compromised.`);
  }

  const worstCase = unbounded
    ? null
    : perms.spend.length === 0
      ? "Nothing. This session carries no spending authority."
      : perms.spend.map((c) => `${formatCap(c)} per ${c.period}`).join(" plus ") +
        `, and only to ${perms.calls.length} allowed call${perms.calls.length === 1 ? "" : "s"}.`;

  return {
    unbounded,
    contracts: preset.contracts.map((c) => CONTRACTS[c]).filter(Boolean) as BlastRadius["contracts"],
    selectors: preset.selectors.map((s) => SELECTORS[s]).filter(Boolean).map((s) => ({
      signature: s!.signature, risk: s!.risk, note: s!.note,
    })),
    caps: perms.spend,
    expiresInHours: preset.expiryHours,
    worstCase,
    warnings,
  };
}

/**
 * Deterministic serialisation for the grant commitment.
 *
 * Altana matches the session bytes on execute, so key order must be stable and
 * bigints must survive as decimal strings rather than being coerced to Number
 * (which silently loses precision above 2^53).
 */
export function canonicalise(perms: SessionPermissions): string {
  const calls = perms.calls
    .map((c) => ({ ...(c.to ? { to: c.to.toLowerCase() } : {}), ...(c.signature ? { signature: c.signature } : {}) }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const spend = perms.spend
    .map((s) => ({ limit: s.limit.toString(), period: s.period, ...(s.token ? { token: s.token.toLowerCase() } : {}) }))
    .sort((a, b) => (a.token ?? "").localeCompare(b.token ?? ""));

  return JSON.stringify({ calls, spend });
}
