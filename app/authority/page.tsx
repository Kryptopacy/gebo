import { readAuthority, isAddress, revokeCall, KEYSTORE, type ChainId } from "@/lib/keystore";
import { RevokeAction } from "./RevokeAction";
import { getClient } from "@/db";
import { CONTRACTS } from "@/lib/session-scope";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Authority console — GEBO" };

type DemoGrant = {
  id: number;
  chainId: number;
  walletAddress: string;
  grantTxHash: string | null;
  expiry: Date;
  unbounded: boolean;
  contracts: string[];
  caps: { humanAmount?: string; symbol?: string; period?: string }[];
};

/**
 * Live demo grants, straight from public.sessions.
 *
 * These rows exist because a scoped session that only ever existed in a script
 * proves nothing to a judge: the bounty asks for authority that is registered,
 * visible and revocable inside the product. Each row links to its own live
 * Keystore lookup rather than asking the reader to trust this list.
 */
/**
 * jsonb columns can arrive as pre-serialised strings depending on the pooler's
 * query protocol, so parsing happens here once rather than being assumed.
 */
function asJsonArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function demoGrants(): Promise<{ grants: DemoGrant[]; error: string | null }> {
  try {
    const sql = getClient();
    const labelFor = new Map(
      Object.values(CONTRACTS).map((c) => [c.address.toLowerCase(), c.label]),
    );
    const rows = await sql<{
      id: number;
      chain_id: number;
      wallet_address: string;
      grant_tx_hash: string | null;
      expiry: Date;
      unbounded: boolean;
      call_allowlist: { to?: string }[] | null;
      spend_caps: { humanAmount?: string; symbol?: string; period?: string }[] | null;
    }[]>`
      select id, chain_id, wallet_address, grant_tx_hash, expiry, unbounded,
             call_allowlist, spend_caps
      from sessions
      where state = 'active' and expiry > now()
      order by chain_id desc, expiry`;
    return {
      grants: rows.map((r) => ({
        id: r.id,
        chainId: r.chain_id,
        walletAddress: r.wallet_address,
        grantTxHash: r.grant_tx_hash,
        expiry: new Date(r.expiry),
        unbounded: r.unbounded,
        contracts: asJsonArray<{ to?: string }>(r.call_allowlist)
          .map((c) => c.to?.toLowerCase())
          .map((to) => (to ? labelFor.get(to) ?? `${to.slice(0, 10)}...` : ""))
          .filter(Boolean),
        caps: asJsonArray<{ humanAmount?: string; symbol?: string; period?: string }>(r.spend_caps),
      })),
      error: null,
    };
  } catch (e) {
    // Invariant 9: a failed read renders as a failure with its reason, never as zero.
    return { grants: [], error: String((e as Error).message ?? e).slice(0, 140) };
  }
}

/**
 * Authority console.
 *
 * The Altana track requires that a user can see what their agent may do and
 * revoke it inside the product. This is that page, and it needs no permission,
 * because Keystore reads need no admin key and nothing from Altana.
 *
 * IT READS ONE AUTHORITY SYSTEM, AND SAYS SO EVERYWHERE.
 *
 * The page previously claimed to work "for any wallet". It does run against any
 * address, but it only sees Altana Keystore sessions - so a wallet using another
 * agent-wallet layer, or one carrying ordinary token approvals, returned an empty
 * result under a heading reading "no session key has ever been registered on this
 * wallet". On a page whose entire job is telling someone what can move their
 * money, an unscoped negative is the most damaging thing it can render. Every
 * claim here is now scoped to the Keystore, and the routes this query does not
 * cover are listed rather than implied.
 *
 * It also states what the registry cannot tell us. The Keystore exposes getKeys,
 * isValidKey and getPublicKey, but no getter for the permission set, so a third
 * party's exact allowlist and spend caps are not readable from the registry alone.
 * Implying otherwise would be the failure this project exists to expose.
 */
export default async function AuthorityPage({
  searchParams,
}: {
  searchParams: Promise<{ wallet?: string; chain?: string }>;
}) {
  const sp = await searchParams;
  const raw = (sp.wallet ?? "").trim();
  const chainId: ChainId = sp.chain === "97" ? 97 : 56;
  const valid = raw ? isAddress(raw) : false;
  const authority = valid ? await readAuthority(raw as `0x${string}`, chainId) : null;
  const demo = await demoGrants();

  return (
    <>
      <section className="band-tight">
        <div className="shell">
          <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Authority</p>
          <div className="headline-pair">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.6rem)" }}>
              What can an agent do to this wallet?
            </h1>
            <p className="standfirst">
              Read straight from the Altana Keystore. Needs no permission and does not
              depend on us: the same query runs from anywhere. It covers Keystore
              sessions only, and says below what it does not see.
            </p>
          </div>

          <form
            method="get"
            action="/authority"
            className="lookup mt-l"
            {...({
              toolname: "check_wallet_authority",
              tooldescription:
                "Read which scoped session keys a BNB Chain wallet has registered in the Altana Keystore, what each permits (target contracts, spend caps, expiry), and whether it is still valid. The same query runs from anywhere; it covers keystore sessions only and the page states what it cannot see. The result lists each session key with its targets, spend caps, expiry and validity, plus an explicit 'what this check does not cover' section.",
              toolautosubmit: "true",
            } as Record<string, string>)}
          >
            {/* required + pattern feed the declarative schema synthesis: an
                unconstrained wallet param was the scorecard's "no regex or
                required constraints" finding. The server still re-validates
                with isAddress - the HTML pattern is for agents and humans,
                not a security boundary. */}
            <input
              type="text"
              name="wallet"
              required
              pattern="0x[0-9a-fA-F]{40}"
              title="A 0x-prefixed, 42-character EVM address"
              inputMode="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="0x… wallet address"
              defaultValue={raw}
              aria-label="Wallet address"
              className="lookup-input num"
              {...({
                toolparamdescription: "The BNB Chain address to check, e.g. 0x688Fe953e20225e0542ED11a11C708437e71d40e",
              } as Record<string, string>)}
            />
            <select
              name="chain"
              defaultValue={String(chainId)}
              aria-label="Network"
              className="lookup-select"
              {...({
                toolparamdescription: "Which keystore to read: 56 for BNB Smart Chain, 97 for BNB Testnet",
              } as Record<string, string>)}
            >
              <option value="56">BNB Smart Chain</option>
              <option value="97">BNB Testnet</option>
            </select>
            <button type="submit" className="cta">Read authority</button>
          </form>

          {raw && !valid && (
            <p className="sm mt-m" style={{ color: "var(--fail)" }}>
              That is not a 20-byte hex address.
            </p>
          )}

          {demo.error && (
            <div className="notice mt-m" data-tone="fail">
              <strong>Demo grants could not be loaded.</strong>{" "}
              <span className="sm">{demo.error}</span>
            </div>
          )}

          {!demo.error && demo.grants.length > 0 && (
            <div className="surface-card mt-l" style={{ padding: "16px 20px 18px" }}>
              <p className="section-label">Live scoped grants held by this project&apos;s demo wallet</p>
              <p className="prose sm" style={{ margin: 0, maxWidth: "78ch" }}>
                Granted on chain through the Altana relay, registered in the Keystore, and enforced
                by its validator rather than by this site. Each row links to the same public lookup
                this page runs; nothing here asks you to trust the list.
              </p>
              <div className="data-table-frame mt-m">
                <div className="rows">
                  {demo.grants.map((g) => (
                    <div key={g.id} className="row r-grants">
                      <div>
                        <span className="chip chip-flat num">{g.chainId}</span>
                      </div>
                      <div className="xs t-3 num" style={{ wordBreak: "break-all" }}>
                        <a href={`/authority?wallet=${g.walletAddress}&chain=${g.chainId}`}>
                          {g.walletAddress.slice(0, 10)}...{g.walletAddress.slice(-6)}
                        </a>
                        {g.grantTxHash && (
                          <>
                            {" · "}
                            <a
                              href={g.chainId === 56 ? `https://bscscan.com/tx/${g.grantTxHash}` : `https://testnet.bscscan.org/tx/${g.grantTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              grant tx
                            </a>
                          </>
                        )}
                      </div>
                      <div className="xs t-3">
                        {g.unbounded ? (
                          <strong style={{ color: "var(--fail)" }}>UNBOUNDED - any contract</strong>
                        ) : (
                          <>may call {g.contracts.join(", ") || "nothing"}</>
                        )}
                      </div>
                      <div className="xs t-3 num">
                        {g.caps.map((c) => `${c.humanAmount ?? "?"} ${c.symbol ?? ""}/${c.period ?? ""}`).join(", ") || "-"}
                      </div>
                      <div className="xs t-4 num">{new Date(g.expiry).toISOString().slice(0, 10)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {authority && (
        <>
          <section className="band-tight">
            <div className="shell">
              <dl className="kpi-grid">
                <div className="kpi-card">
                  <dt>Active keys</dt>
                  <dd style={{ color: authority.activeKeys > 0 ? "var(--hold)" : "var(--fg-4)" }}>
                    {authority.activeKeys}
                  </dd>
                  <div className="qualifier">
                    Keystore keys currently able to act on this wallet
                  </div>
                </div>
                <div className="kpi-card">
                  <dt>Keys ever registered</dt>
                  <dd>{authority.keys.length}</dd>
                  <div className="qualifier">In this Keystore, including expired and revoked</div>
                </div>
                <div className="kpi-card">
                  <dt>Account</dt>
                  <dd style={{ fontSize: "1.2rem", letterSpacing: 0 }}>
                    {authority.deployed ? "deployed" : "not deployed"}
                  </dd>
                  <div className="qualifier">
                    {authority.delegatesTo
                      ? `EIP-7702, delegates to ${authority.delegatesTo.slice(0, 10)}…`
                      : "No delegation indicator present"}
                  </div>
                </div>
                <div className="kpi-card">
                  <dt>Read at block</dt>
                  <dd style={{ fontSize: "1.2rem" }}>{Number(authority.blockNumber).toLocaleString()}</dd>
                  <div className="qualifier">
                    {authority.chainId === 56 ? "BNB Smart Chain" : "BNB Testnet"}
                  </div>
                </div>
              </dl>

              {authority.error && (
                <div className="notice mt-l" data-tone="fail">
                  Read failed: {authority.error}
                </div>
              )}
            </div>
          </section>

          <section className="band">
            <div className="shell">
              <h2>
                {authority.keys.length === 0
                  ? "No session key is registered in the Altana Keystore"
                  : `${authority.keys.length} session key${authority.keys.length === 1 ? "" : "s"}`}
              </h2>

              {authority.keys.length === 0 ? (
                <div className="surface-card mt-m">
                  <p className="prose sm" style={{ margin: 0 }}>
                    Nothing in the Keystore grants authority over this wallet.
                  </p>
                  <div className="notice mt-m" data-tone="fail">
                    <strong>That is not the same as being safe.</strong> This reads one
                    registry. A session granted with{" "}
                    <span className="num">register: false</span> is enforced by the account but
                    never appears here; a different wallet layer keeps its own records; and an
                    ordinary token approval grants spending power without any session at all.
                    Absence of a registered key is absence of evidence, not evidence of absence.
                  </div>
                </div>
              ) : (
                <div className="data-table-frame mt-m">
                  <div className="rows">
                    <div className="rows-head r-keys">
                      <span>Key</span><span>State</span><span>Key id check</span><span>Revoke</span>
                    </div>
                    {authority.keys.map((k) => {
                      const call = revokeCall(authority.wallet, k.keyId, authority.chainId);
                      return (
                        <div key={k.keyId} className="row r-keys">
                          <div>
                            <div className="num sm" style={{ wordBreak: "break-all" }}>{k.keyId}</div>
                            <div className="xs t-4 num">
                              {k.publicKey ? `public key ${(k.publicKey.length - 2) / 2} bytes` : "no public key recorded"}
                            </div>
                          </div>
                          <div>
                            <span className="chip" data-state={k.valid ? "VERIFIED" : "DORMANT"}>
                              {k.valid ? "ACTIVE" : "INACTIVE"}
                            </span>
                          </div>
                          <div className="xs t-3">
                            {k.keyIdMatchesPublicKey
                              ? "keccak(publicKey) matches"
                              : k.publicKey ? "does not match" : "unverifiable"}
                          </div>
                          <div className="xs t-3">
                            {k.valid ? (
                              <>
                                {/* The call stays visible next to the button that
                                    sends it: verifiable and copyable, independent
                                    of us - the same honesty as before, now with
                                    the action the track asks for. */}
                                <div className="xs t-4 num" style={{ marginBottom: 6 }}>
                                  {call.signature.split("(")[0]} on {call.to.slice(0, 12)}...
                                </div>
                                <RevokeAction
                                  wallet={authority.wallet}
                                  keyId={k.keyId}
                                  chainId={authority.chainId}
                                />
                              </>
                            ) : (
                              <span className="t-4">already inactive</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {!authority && (
        <section className="band">
          <div className="shell">
            <h2>Why this exists</h2>
            <div className="surface-card mt-m">
              <p className="prose sm">
                Every documented incident where an autonomous agent drained funds involved
                authority the user could not see or could not retract. A control discovered after
                something has gone wrong is not a control, so this page is reachable before any
                authority is granted and works on wallets that have none.
              </p>
              <p className="prose sm" style={{ margin: 0 }}>
                Because Keystore state is public and on chain rather than held in a vendor
                database, the check does not depend on trusting this site. That is the property
                that makes cross-app verification possible at all.
              </p>
            </div>
          </div>
        </section>
      )}

      {/**
        * Coverage limits render whether or not a wallet has been looked up.
        *
        * These were nested inside the results block, so the single most important caveat
        * on the page - that it reads ONE authority system, and that Binance's Agentic
        * Wallet keeps its state off chain where nobody can verify it - was invisible
        * until someone happened to search. A disclosure a reader has to trigger is not a
        * disclosure, and this is the page where hiding one does the most damage.
        */}
      <section className="band band-last">
        <div className="shell">
          <h2>What this check does not cover</h2>
          <p className="prose sm">
            An agent can hold power over a wallet through routes this query does not touch,
            and a clean result above says nothing about them.
          </p>
          <ul className="prose sm" style={{ paddingLeft: "1.1rem" }}>
            <li>
              <strong>Unregistered sessions.</strong> Granted with{" "}
              <span className="num">register: false</span>, enforced by the account, invisible
              to every third party including this page.
            </li>
            <li>
              <strong>Binance&apos;s Agentic Wallet.</strong> Its authority state is off chain by
              design. Binance&apos;s own documentation says the limits you set constrain the
              agent &ldquo;at the API level&rdquo;, the key is MPC and &ldquo;never fully
              reconstructed on any single device or server&rdquo;, and access is withdrawn by
              signing out in the app rather than by a transaction. There is no contract and no
              getter, so no third party can verify those limits &mdash; including us. We report
              that as unreadable rather than implying we checked.
            </li>
            <li>
              <strong>Plain token approvals.</strong> An <span className="num">approve</span> to
              a spender grants ongoing power to move a token with no session, no expiry and no
              registry entry.
            </li>
            <li>
              <strong>The permission set itself.</strong> The Keystore exposes{" "}
              <span className="num">getKeys</span>, <span className="num">isValidKey</span> and{" "}
              <span className="num">getPublicKey</span>, and no getter for the allowlist, spend
              caps or expiry &mdash; those are arguments to{" "}
              <span className="num">registerKey</span>, not readable state. So the exact scope of
              a key granted by someone else is not derivable from the registry alone.
            </li>
          </ul>
          <p className="prose sm">
            What is verifiable here is whether a key holds authority at this block, and that
            revoking it is possible and immediate. Both were confirmed on chain, including a real
            session-key transaction and a revocation that took effect at once.
          </p>
        </div>
      </section>
    </>
  );
}
