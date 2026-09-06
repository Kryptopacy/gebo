import type { Metadata } from "next";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import { loadCensus, loadAggregates, JUDGED_CATEGORIES, OTHER_CATEGORIES } from "@/lib/data";
import { ThemeToggle } from "./theme-toggle";
import { CategoriesDropdown } from "./categories-dropdown";
import { MobileNav } from "./mobile-nav";
import AssistantWidget from "./assistant/AssistantWidget";
import { OverflowGuard } from "./overflow-guard";
import WebMcpTools from "./WebMcpTools";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

/**
 * Official vector emblem for BNB Chain (BSC).
 */
function BnbLogo({ className = "", size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="BNB Chain"
    >
      <path
        d="M16 32C24.8366 32 32 24.8366 32 16C32 7.16344 24.8366 0 16 0C7.16344 0 0 7.16344 0 16C0 24.8366 7.16344 32 16 32Z"
        fill="#F0B90B"
      />
      <path
        d="M12.115 14.404L16 10.519L19.885 14.404L22.64 11.649L16 5L9.36 11.649L12.115 14.404ZM5 16L7.755 13.245L10.51 16L7.755 18.755L5 16ZM12.115 17.596L16 21.481L19.885 17.596L22.64 20.351L16 27L9.36 20.351L12.115 17.596ZM27 16L24.245 13.245L21.49 16L24.245 18.755L27 16ZM17.942 16L16 14.058L14.058 16L16 17.942L17.942 16Z"
        fill="#0C0E12"
      />
    </svg>
  );
}

/**
 * Metadata is generated per request from the persisted census, not hardcoded.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3100");

export async function generateMetadata(): Promise<Metadata> {
  const c = await loadCensus();
  const minted = c.tokensMinted.toLocaleString();
  const callable = c.callable.toLocaleString();

  const title = "GEBO · Agent registry for BNB Smart Chain";
  const description =
    `${minted} agents are registered on BNB Chain. ${callable} can actually be hired. ` +
    `GEBO reads the registry directly, audits what each agent declares, and shows what ` +
    `it is permitted to do to your wallet before you authorise anything.`;
  const short = `${minted} agents registered. ${callable} callable. GEBO measures which.`;

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    openGraph: { title, description: short, url: siteUrl, siteName: "GEBO", type: "website" },
    twitter: { card: "summary_large_image", title, description: short },
  };
}

const themeInitScript = `
(function() {
  try {
    var saved = localStorage.getItem('gebo-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [census, aggregates] = await Promise.all([loadCensus(), loadAggregates()]);
  const categoryCounts = aggregates.categories ?? {};

  /**
   * One directory, core job categories first, listed whether or not a count
   * read succeeded. Splitting nav into "judged" vs other sections leaked the
   * build's internal scoring frame into the storefront; a marketplace front
   * door presents one catalog. Counts render only when the read that produced
   * them succeeded (count = null means unmeasured, never zero - invariant 9).
   */
  const allCategories = [...JUDGED_CATEGORIES, ...OTHER_CATEGORIES].map((c) => ({
    slug: c.slug,
    meta: c,
    count: aggregates.live ? (categoryCounts[c.slug] ?? 0) : null,
  }));

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <header className="masthead">
          <div className="shell">
            <a href="/" className="wordmark" aria-label="GEBO home">
              <Image
                src="/gebo-mark.png"
                alt=""
                width={26}
                height={26}
                priority
                className="wordmark-mark"
              />
              <span className="wordmark-text">GEBO</span>
            </a>
            <form
              method="get"
              action="/search"
              className="masthead-search"
              role="search"
              {...({
                toolname: "search_agents",
                tooldescription:
                  "Search GEBO's registry of BNB Smart Chain agents by capability. Navigates to results ordered by trust state, then relevance.",
                toolautosubmit: "true",
              } as Record<string, string>)}
            >
              <input
                type="search"
                name="q"
                placeholder="Search agents by capability..."
                aria-label="Search agents by capability"
                autoComplete="off"
                spellCheck={false}
                {...({
                  toolparamdescription:
                    "What the agent should do, e.g. 'rebalance liquidity', 'watch my loan', 'x402 payments'",
                } as Record<string, string>)}
              />
            </form>
            <nav aria-label="Primary Navigation">
              <CategoriesDropdown categories={allCategories} />
              <a href="/live">Liveness</a>
              <a href="/authority">Authority</a>
              <a href="/methodology">Methodology</a>
            </nav>
            <ThemeToggle />
            <MobileNav categories={allCategories} />
          </div>
        </header>

        {children}

        <OverflowGuard />
        <AssistantWidget />
        <WebMcpTools />

        <footer className="colophon">
          <div className="shell">
            <div className="colophon-grid">
              {/* Col 1: Brand & Verification Narrative */}
              <div className="colophon-brand">
                <a href="/" className="wordmark" style={{ marginBottom: 14 }} aria-label="GEBO home">
                  <Image src="/gebo-mark.png" alt="" width={24} height={24} className="wordmark-mark" />
                  <span className="wordmark-text" style={{ fontSize: 18 }}>GEBO</span>
                </a>
                <p>
                  A verification-first agent registry for BNB Smart Chain. Every figure in GEBO is measured directly from the chain and reproducible from open-source scripts.
                </p>
                <div className="stack-sm mt-m">
                  <a href="/methodology" className="link">Read the methodology →</a>
                </div>
              </div>

              {/* Col 2: Category directory - one catalog, core jobs first */}
              <div className="colophon-col">
                <div className="colophon-title">
                  <span>Agent Jobs</span>
                </div>
                {/* The four flagship jobs only - the full nine-category
                    directory is a whole page (/categories), not a footer
                    dump; a short list that reads as a front door beats a
                    long one that reads as a sitemap. */}
                <ul className="colophon-links">
                  {allCategories.slice(0, 4).map((c) => (
                    <li key={c.slug}>
                      {/* Tandem, same as the header dropdown: the punchy title
                          serves people who know the vocabulary, the job line
                          serves everyone else. No venue badges - the venue
                          belongs on the category page hero where it has
                          context. */}
                      <a href={`/c/${c.slug}`}>
                        <span>{c.meta.title}</span>
                      </a>
                      <div className="xs t-4" style={{ marginTop: 1 }}>{c.meta.job}</div>
                    </li>
                  ))}
                  <li>
                    <a href="/categories" style={{ color: "var(--accent)" }}>
                      + View all categories →
                    </a>
                  </li>
                </ul>
              </div>

              {/* Col 3: Protocol & Tools */}
              <div className="colophon-col">
                <div className="colophon-title">Protocol & Tools</div>
                <ul className="colophon-links">
                  <li><a href="/live">Live Handshake Feed</a></li>
                  <li><a href="/authority">Authority & Keystore Console</a></li>
                  <li><a href="/search">Capability Search Engine</a></li>
                  <li><a href="/methodology">Measurement & Defect Log</a></li>
                  <li>
                    <a
                      href="https://github.com/Kryptopacy/gebo"
                      target="_blank"
                      rel="noreferrer"
                      className="link xs"
                      style={{ marginTop: 6, display: "inline-block" }}
                    >
                      Audit Scripts (Open Source) ↗
                    </a>
                  </li>
                </ul>
              </div>

              {/* Col 4: On-Chain Spec Card (BSC) */}
              <div className="colophon-col">
                <div className="colophon-title">On-Chain Architecture</div>
                <div className="colophon-spec-card">
                  <div className="colophon-spec-header">
                    <div className="colophon-spec-chain">
                      <BnbLogo size={24} />
                      <div>
                        <div className="colophon-spec-chain-name">BNB Smart Chain</div>
                        <div className="colophon-spec-chain-meta">Mainnet · Chain ID 56</div>
                      </div>
                    </div>
                    <span className="pulse-dot" data-status="pass" title="Chain Synchronized" />
                  </div>

                  <div className="colophon-spec-rows">
                    <div className="colophon-spec-row">
                      <span className="colophon-spec-label">Identity Registry</span>
                      <a
                        href="https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
                        target="_blank"
                        rel="noreferrer"
                        className="colophon-spec-link"
                        title="View ERC-8004 IdentityRegistry contract on BscScan"
                      >
                        <span>0x8004…a432</span>
                        <span style={{ fontSize: 10 }}>↗</span>
                      </a>
                    </div>

                    <div className="colophon-spec-row">
                      <span className="colophon-spec-label">Altana Keystore</span>
                      <a
                        href="https://bscscan.com/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a"
                        target="_blank"
                        rel="noreferrer"
                        className="colophon-spec-link"
                        title="View Altana Keystore contract on BscScan"
                      >
                        <span>0x6572…7E0a</span>
                        <span style={{ fontSize: 10 }}>↗</span>
                      </a>
                    </div>

                    <div className="colophon-spec-row">
                      <span className="colophon-spec-label">Verification Mode</span>
                      <span className="colophon-spec-value">
                        <span>Permissionless</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="colophon-bottom">
              <div className="colophon-meta">
                <span>© {new Date().getFullYear()} GEBO</span>
                <span className="t-4">·</span>
                <span>Verification-First Agent Registry for BNB Chain</span>
              </div>
              <div className="xs t-4">
                Measured on BNB Smart Chain · Blocks read directly via JSON-RPC
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
