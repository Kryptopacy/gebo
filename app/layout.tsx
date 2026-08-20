import type { Metadata } from "next";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import { loadCensus } from "@/lib/data";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
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
            <nav aria-label="Categories">
              <a href="/c/rebalancing">Rebalancing</a>
              <a href="/c/grid">Grid</a>
              <a href="/c/yield">Yield</a>
              <a href="/c/health">Health factor</a>
              <a href="/c/trading" className="nav-sep">Trading</a>
              <a href="/c/research">Research</a>
              <a href="/c/payments">Payments</a>
              <a href="/methodology" className="nav-sep">Methodology</a>
            </nav>
          </div>
        </header>

        {children}

        <footer className="colophon">
          <div className="shell">
            <div className="colophon-grid">
              <div>
                <p>
                  Every figure in GEBO is measured by this project and reproducible from
                  the scripts in it. Definitions and known defects are published rather
                  than implied.
                </p>
                <a href="/methodology" className="link">Read the methodology</a>
              </div>
              <dl className="spec">
                <div><dt>Identity registry</dt><dd>0x8004a169…a432</dd></div>
                <div><dt>Chain</dt><dd>BNB Smart Chain · 56</dd></div>
                <div><dt>Keystore</dt><dd>0x6572427E…7E0a</dd></div>
              </dl>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
