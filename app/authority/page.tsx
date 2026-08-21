import { readAuthority, isAddress, revokeCall, KEYSTORE, type ChainId } from "@/lib/keystore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Authority console.
 *
 * The Altana track requires that a user can see what their agent may do and
 * revoke it inside the product. This is that page, and it works for ANY wallet
 * without permission, because Keystore reads need no admin key and nothing from
 * Altana.
 *
 * It states plainly what the registry cannot tell us. The Keystore exposes
 * getKeys, isValidKey and getPublicKey, but no getter for the permission set, so
 * a third party's exact allowlist and spend caps are not readable from the
 * registry alone. Implying otherwise would be the failure this project exists to
 * expose.
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
              Read straight from the Altana Keystore. Works for any wallet, needs no
              permission, and does not depend on us: the same query runs from anywhere.
            </p>
          </div>

          <form method="get" action="/authority" className="lookup mt-l">
            <input
              type="text"
              name="wallet"
              inputMode="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="0x… wallet address"
              defaultValue={raw}
              aria-label="Wallet address"
              className="lookup-input num"
            />
            <select name="chain" defaultValue={String(chainId)} aria-label="Network" className="lookup-select">
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
        </div>
      </section>

      {authority && (
        <>
          <section className="band-tight">
            <div className="shell">
              <dl className="readouts">
                <div className="readout">
                  <dt>Active keys</dt>
                  <dd style={{ color: authority.activeKeys > 0 ? "var(--hold)" : "var(--fg-4)" }}>
                    {authority.activeKeys}
                  </dd>
                  <div className="qualifier">
                    Keys currently able to act on this wallet
                  </div>
                </div>
                <div className="readout">
                  <dt>Keys ever registered</dt>
                  <dd>{authority.keys.length}</dd>
                  <div className="qualifier">Including expired and revoked</div>
                </div>
                <div className="readout">
                  <dt>Account</dt>
                  <dd style={{ fontSize: "1rem", letterSpacing: 0 }}>
                    {authority.deployed ? "deployed" : "not deployed"}
                  </dd>
                  <div className="qualifier">
                    {authority.delegatesTo
                      ? `EIP-7702, delegates to ${authority.delegatesTo.slice(0, 10)}…`
                      : "No delegation indicator present"}
                  </div>
                </div>
                <div className="readout">
                  <dt>Read at block</dt>
                  <dd style={{ fontSize: "1.1rem" }}>{Number(authority.blockNumber).toLocaleString()}</dd>
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
                  ? "No session key has ever been registered on this wallet"
                  : `${authority.keys.length} session key${authority.keys.length === 1 ? "" : "s"}`}
              </h2>

              {authority.keys.length === 0 ? (
                <>
                  <p className="prose sm">
                    Nothing in the Keystore grants authority over this wallet.
                  </p>
                  <div className="notice mt-m" data-tone="fail">
                    <strong>That is not the same as being safe.</strong> A session granted with{" "}
                    <span className="num">register: false</span> is enforced by the account but
                    never appears here, so it holds real authority while remaining invisible to
                    every third party. Absence of a registered key is absence of evidence, not
                    evidence of absence.
                  </div>
                </>
              ) : (
                <div className="rows mt-m">
                  <div className="rows-head" style={{ gridTemplateColumns: "minmax(0,1.4fr) 6rem 8rem minmax(0,1fr)" }}>
                    <span>Key</span><span>State</span><span>Key id check</span><span>Revoke</span>
                  </div>
                  {authority.keys.map((k) => {
                    const call = revokeCall(authority.wallet, k.keyId, authority.chainId);
                    return (
                      <div key={k.keyId} className="row" style={{ gridTemplateColumns: "minmax(0,1.4fr) 6rem 8rem minmax(0,1fr)" }}>
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
                              <span className="num">{call.signature.split("(")[0]}</span>
                              <div className="xs t-4">on {call.to.slice(0, 12)}…</div>
                            </>
                          ) : (
                            <span className="t-4">already inactive</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="band">
            <div className="shell">
              <h2>What this page cannot tell you</h2>
              <p className="prose sm">
                The Keystore exposes <span className="num">getKeys</span>,{" "}
                <span className="num">isValidKey</span> and{" "}
                <span className="num">getPublicKey</span>. It exposes no getter for the
                permission set: the contract allowlist, spend caps and expiry are arguments to{" "}
                <span className="num">registerKey</span>, not readable state. So the exact scope
                of a key granted by someone else is not derivable from the registry alone.
              </p>
              <p className="prose sm">
                What is verifiable here is whether a key holds authority at this block, and that
                revoking it is possible and immediate. Both were confirmed on chain, including a
                real session-key transaction and a revocation that took effect at once.
              </p>
              <dl className="spec mt-m">
                <div>
                  <dt>Keystore</dt>
                  <dd className="mono">{KEYSTORE[authority.chainId]}</dd>
                </div>
                <div>
                  <dt>Revocation</dt>
                  <dd>
                    <span className="num">revokeKey(user, keyId)</span> — immediate and
                    monotonic. A revoked key cannot be reinstated.
                  </dd>
                </div>
                <div>
                  <dt>Who can revoke</dt>
                  <dd>
                    The key owner or validator only. GEBO holds no keys and cannot revoke on your
                    behalf, which is why the call is shown rather than offered as a button.
                  </dd>
                </div>
                <div>
                  <dt>Independently verifiable</dt>
                  <dd>
                    Anyone can repeat this read. It needs no admin key, no session, and nothing
                    from Altana or from us.
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </>
      )}

      {!authority && (
        <section className="band band-last">
          <div className="shell">
            <h2>Why this exists</h2>
            <p className="prose sm">
              Every documented incident where an autonomous agent drained funds involved
              authority the user could not see or could not retract. A control discovered after
              something has gone wrong is not a control, so this page is reachable before any
              authority is granted and works on wallets that have none.
            </p>
            <p className="prose sm">
              Because Keystore state is public and on chain rather than held in a vendor
              database, the check does not depend on trusting this site. That is the property
              that makes cross-app verification possible at all.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
