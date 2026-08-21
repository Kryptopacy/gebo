import type { Metadata } from "next";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import { loadCensus } from "@/lib/data";
import { ThemeToggle } from "./theme-toggle";
import { CategoriesDropdown } from "./categories-dropdown";
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
 * Metadata is generated per request from the persisted census, not hardcoded.
 * Hardcoding meant the title, the headline, and the docs each carried their own
 * copy of the same figure, and a re-run of the census silently made all three
 * wrong. generateMetadata reads the same source the page does.
 *
 * metadataBase resolves relative OG image URLs; without it Next falls back to
 * localhost and social previews break in production.
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
            <form method="get" action="/search" className="masthead-search" role="search">
              <input
                type="search"
                name="q"
                placeholder="Search agents by capability..."
                aria-label="Search agents by capability"
                autoComplete="off"
                spellCheck={false}
              />
            </form>
            <nav aria-label="Primary Navigation">
              <CategoriesDropdown />
              <a href="/live">Liveness</a>
              <a href="/authority">Authority</a>
              <a href="/methodology">Methodology</a>
            </nav>
            <ThemeToggle />
          </div>
        </header>

        {children}

        <footer className="colophon">
          <div className="shell">
            <div className="colophon-grid">
              {/* Col 1: Brand & Philosophy */}
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

              {/* Col 2: Verified Agent Jobs */}
              <div className="colophon-col">
                <div className="colophon-title">Verified Jobs</div>
                <ul className="colophon-links">
                  <li><a href="/c/rebalancing">Rebalancing (PancakeSwap)</a></li>
                  <li><a href="/c/grid">Grid Trading</a></li>
                  <li><a href="/c/yield">Yield Routing</a></li>
                  <li><a href="/c/health">Health Factor Defence</a></li>
                  <li><a href="/c/trading">Trading & Execution</a></li>
                  <li><a href="/c/research">Research & Screening</a></li>
                  <li><a href="/c/payments">Payments (x402)</a></li>
                </ul>
              </div>

              {/* Col 3: Protocol & Tools */}
              <div className="colophon-col">
                <div className="colophon-title">Protocol & Tools</div>
                <ul className="colophon-links">
                  <li><a href="/live">Live Handshake Feed</a></li>
                  <li><a href="/authority">Authority & Keystore Console</a></li>
                  <li><a href="/search">Capability Search</a></li>
                  <li><a href="/methodology">Measurement & Defect Log</a></li>
                </ul>
              </div>

              {/* Col 4: On-Chain Spec */}
              <div className="colophon-col">
                <div className="colophon-title">On-Chain Spec (BSC)</div>
                <dl className="spec">
                  <div>
                    <dt>Identity registry</dt>
                    <dd>
                      <a
                        href="https://bscscan.com/address/0x8004a169D4F11E55Fd67b1348881A25B4468a432"
                        target="_blank"
                        rel="noreferrer"
                        className="link mono"
                        title="View contract on BscScan"
                      >
                        0x8004…a432 ↗
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Chain</dt>
                    <dd>BNB Smart Chain · 56</dd>
                  </div>
                  <div>
                    <dt>Keystore</dt>
                    <dd>
                      <a
                        href="https://bscscan.com/address/0x6572427E3e0bB1F70b2c3479B48f3F108C507E0a"
                        target="_blank"
                        rel="noreferrer"
                        className="link mono"
                        title="View contract on BscScan"
                      >
                        0x6572…7E0a ↗
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="colophon-bottom">
              <div className="colophon-meta">
                <span>© {new Date().getFullYear()} GEBO</span>
                <span className="t-4">·</span>
                <span>Verification-First Agent Registry for BNB Chain</span>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
