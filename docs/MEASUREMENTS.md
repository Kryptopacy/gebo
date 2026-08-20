# GEBO — Measurements

First-party measurements, not claims. Every number here was produced by code in this repo
against live data. Reproduce with `npx tsx scripts/analyse-census.ts`.

---

## 0. Registry census — 85% coverage of the whole registry

**Run:** 2026-08-19 · BSC mainnet · **228,750 of 269,726 tokens read directly from the
ERC-8004 Identity Registry** (`0x8004a169…a432`) · raw data `data/registry-bsc.ndjson`

This section supersedes the 120-agent sample in §2. It is chain-wide, not sampled, and it
cost nothing — direct multicall reads at ~37/sec rather than a rate-limited API.

### The funnel, measured

```
269,726   tokens minted in the registry
228,750   censused so far                              85% coverage
140,307   registration file resolved                   61.3%  (the data: URIs; remote deferred)
140,300   carry a name                                100.0%  of resolved
138,472   self-declare  "active": true                 98.7%  of resolved
    741   declare ANY service endpoint                  0.53% of resolved
    345   callable and lint-clean                       0.25% of resolved
     68   distinct operators actually running endpoints
```

> **~137,700 agents claim to be active while exposing no endpoint of any kind.**
>
> `"active": true` is self-declared, unverified, and asserted by 98.7% of resolved
> registrations — against 0.53% that declare an endpoint. It is the single least
> informative field in the standard, and any marketplace that surfaces it as a
> liveness signal is repeating a claim rather than reporting a fact.

### Metadata pointer distribution

| Scheme | Count | Share | Note |
| --- | --- | --- | --- |
| `data:` | 140,347 | 61.35% | fully on-chain, resolves with zero network |
| `https:` | 72,896 | 31.87% | deferred in this pass; remote fetch is the bottleneck |
| *empty* | 9,099 | 3.98% | **registered with no metadata pointer at all** |
| `other` | 5,099 | 2.23% | unrecognised scheme |
| `ipfs:` | 1,300 | 0.57% | gateway-dependent |
| `http:` | 9 | 0.00% | unencrypted |

### Declared trust models

131,313 registrations declare `supportedTrust: ["reputation"]`.

| Model | Count |
| --- | --- |
| `reputation` | 131,313 |
| *(empty string)* | 1,042 |
| `crypto-economic` | 67 |
| `tee-attestation` | 53 |
| `4lpha-owner-signature` | 23 |
| `bnb-chain-onchain-identity` | 23 |

> 131,313 agents nominate **reputation** as their trust model, in an ecosystem that has
> recorded **zero validations on any chain** and 11,705 feedback entries total on BSC —
> roughly one review per twelve agents that claim to rely on reviews.

### Endpoint kinds, where any exist

`web` 657 · `a2a` 314 · `mcp` 283 — across just 741 registrations.

### Fatal registration defects found by lint

`unparseable_url` 8 · `loopback_host` 4 · `placeholder_domain` 3. Small in absolute terms
because so few registrations declare an endpoint at all; 15 of 741 endpoint-bearing
registrations (2.0%) are structurally uncallable. Note `example.com` appears as a
production endpoint domain **20 times**.

## 0.1 Concentration — corrected, and more interesting than the first read

The sample in §3 suggested a few operators mass-minting identities. At registry scale that
is **wrong about ownership and right about infrastructure**, and the distinction matters.

| Ownership | Value |
| --- | --- |
| Distinct owners | **191,628** |
| Mean agents per owner | **1.2** |
| Owners holding exactly one agent | **182,942** |
| Largest owner | 13,419 agents — 5.87% |
| Top 10 owners combined | **8.78%** |

| Infrastructure | Value |
| --- | --- |
| Distinct operators (endpoint domains) | **68** |
| Largest operator share of endpoints | **56.34%** (`singularry.org`, 702 endpoints) |
| Top 5 operators | **87.56%** |
| Top 20 operators | **94.62%** |

```
operator                          endpoints   callable
singularry.org                          702        702
ensoul.ac                               323          0
bubbleupdappos.workers.dev               23         23
clipx.app                                22         22
4lpha.tech                               21          0
example.com                              20         19
lobkill.com                              11          0
```

> **191,628 people registered an identity. 68 organisations run infrastructure. 345 agents
> are actually callable.**
>
> So this is not a handful of bulk minters — it is a crowd of ~183,000 wallets registering
> one agent each, which is the signature of points or airdrop farming rather than supply.
> The concentration lives in *endpoints*, not *ownership*, and only an endpoint-derived
> operator identity reveals it. Ranking by owner address would show 191,628 independent
> suppliers, which is false.

`ensoul.ac` is worth singling out: 323 declared endpoints, **zero** callable.

---

## 1. Population (8004scan API, for cross-reference)

| Measure | Value |
| --- | --- |
| Registered on BSC | **257,888** |
| Declares MCP | 4,680 |
| Declares A2A | 13,539 |
| **Callable upper bound (MCP+A2A, overlap not deduped)** | **18,219 — 7.1%** |
| Total feedbacks, all time | 11,705 |
| Feedbacks today | **0** |
| New agents today | 263 |

**~93% of agents on BSC declare no machine-callable endpoint.** They cannot be hired by
software at all. This is the single largest and least contestable filter in the product.

## 2. Reachability, by cohort

Sampling is stratified because the population is bimodal. A blended number would hide that.

| | NEWEST (n=60) | BEST (n=60) |
| --- | --- | --- |
| Has a probeable endpoint | 60 (100%) | 60 (100%) |
| Responded 2xx | **38 (63.3%)** | **58 (96.7%)** |
| Latency p50 | 426 ms | 1,421 ms |
| Latency p95 | 3,965 ms | 4,836 ms |
| Error classes | `http_4xx: 9, other: 13` | `refused: 1, http_4xx: 1` |

Combined: **96 / 120 = 80% of callable agents responded.**

### This refutes part of the original thesis, and that matters

The strategy document asserted the job was to "prove which handful are real." **That was too
strong.** Once you filter to agents that are actually callable, most of them answer an HTTP
request. Liveness is a weaker differentiator than assumed, and the honest correction is
recorded here rather than buried.

Note also that the BEST cohort is **3.3× slower at p50** than NEWEST — consistent with real
agents doing real work on cold-starting hosts (vercel/fly/AWS), while mass-minted ones return
a static document quickly. Fast is not good.

**Caveat that must not be dropped: a 2xx GET is a weak test.** It proves a server answered,
not that an agent functions. The next iteration must validate the A2A agent card against
schema and complete an MCP `initialize` handshake. Until then, "responded" means only
"something served bytes."

## 3. The real finding: operator concentration

| Measure | Value |
| --- | --- |
| Distinct endpoint hosts | **21** for 120 agents |
| Top 3 hosts | **55%** of the sample |
| NEWEST cohort, top 2 hosts | **52 / 60 = 87%** |

NEWEST cohort host distribution:

```
30  q402.quackai.ai
22  platform-backend.prod.termix.live
 4  agents.chainhelix.io
 2  api.bortagent.xyz
 1  bnb-grid.172-104-171-139.nip.io
 1  stockanalyst-agents.fly.dev
```

BEST cohort is more diverse (13 `app.singularry.org`, 10 `aliasai.io`, 7 `erc8004.heyanon.ai`,
6 `bobbuildonbnb.vercel.app`, 6 `www.8004scan.io`, 4 `clipx.app`, …).

> **257,888 registered agents do not represent 257,888 suppliers.** They substantially
> represent a small number of platforms minting agent identities in bulk. In the newest
> cohort, **two operators account for 87% of registrations.**

This is a better thesis than "most agents are dead," because it is structural rather than
incidental, and it survives the fact that most callable agents respond. A marketplace ranking
agents independently would show what looks like variety while actually surfacing two vendors.

**Design consequences:**
- Operator identity is a first-class listing field, derived from endpoint host + owner address.
- Diversity must be enforced in ranking: cap how many results one operator can occupy.
- "Agent Diversity" in the rubric should be read as *operator* diversity, not row count.

## 4. 8004scan's `health_score` is non-monotonic with reachability

I previously claimed 8004scan had no liveness data (wrong — it does), then that its
`health_score` was "effectively binary" (also wrong — it is graded). Both corrections stand.
The measured distribution:

| `health_score` | n | We got 2xx | Agreement |
| --- | --- | --- | --- |
| 15 | 5 | 4 | **80%** |
| 25 | 2 | 0 | 0% |
| 50 | 25 | 6 | **24%** |
| 65 | 31 | 31 | **100%** |
| 66.67 | 1 | 0 | 0% |
| 75 | 3 | 3 | 100% |
| 83.33 | 4 | 4 | 100% |
| 100 | 49 | 48 | 98% |

**Agents scored 15 responded 80% of the time. Agents scored 50 responded 24% of the time.**
The score is not monotonic in actual reachability, so it cannot be used to decide who to hire.

This is the corrected — and stronger — basis for the differentiator. The claim is not "they
don't measure health." It is:

> **`health_score` is a metadata/composite score, not a reachability measure. It is
> non-monotonic against measured response, so a user cannot use it to choose an agent.**

That is demonstrated with our own data, which is exactly the standard `/methodology` should
hold us to.

## 5. Broken registrations at scale — including a sponsor's

**22 of 120 sampled agents (18%) registered an endpoint URL containing an unsubstituted
template variable:**

```
https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card
                                                            ^^^^^^^^^
```

`{agentId}` was never replaced. These registrations are unusable by any client, and there are
22 of them in a 60-agent cohort. The host belongs to **TermiX, a hackathone sponsor** — stated
plainly because it is a factual data-quality observation, and because it is precisely the class
of defect this marketplace should catch.

**Design consequence:** add a registration-lint pass. Detect and flag unsubstituted template
variables (`{...}`, `:param`, `<placeholder>`), non-http(s) schemes, localhost/RFC-1918 hosts,
and bare IPs. Surface as a listing defect, not a silent failure. This is cheap, mechanical, and
no competitor will do it.

## 6. Revised funnel

```
257,888   registered on BSC
   ↓  −93%  no callable endpoint declared
 18,219   callable (MCP or A2A)
   ↓  −18%  registration defects (template vars, bad schemes) — extrapolated from sample
   ↓  −20%  no 2xx response
 ~12,000  respond to a naive GET
   ↓        ← 2xx is NOT competence. Schema + handshake validation still required.
   ↓  concentration: ~21 distinct hosts per 120 agents
    ~?     distinct, competent, accountable suppliers  ← the number the product exists to find
```

The last line is deliberately unresolved. Filling it in honestly is the product.

## 7. Method and its known defects

Per design law L9, the defects are published alongside the numbers.

- **Single-region probe.** One vantage point. An agent geo-blocking or ASN-blocking us appears
  dead. We cannot distinguish "down" from "unreachable from here."
- **GET-only.** No schema validation, no MCP handshake. Overstates health.
- **Sample, not census.** 120 of 18,219 callable agents. Cohort-stratified, not random;
  `sortBy` ordering means these are extremes, not the middle of the distribution.
- **MCP+A2A overlap not deduped**, so 18,219 is an upper bound on callable agents.
- **No retry before marking failure.** A single transient error counts as a failure here. The
  production prober requires consistency across windows before asserting anything, and never
  writes on-chain from a single observation.
- **8004scan population counts drift between calls** (257,816 → 257,832 → 257,888 across the
  session) because registration is continuous. Numbers are point-in-time.
