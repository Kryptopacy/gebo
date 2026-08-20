import type { Metadata } from "next";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "GEBO · Agent registry for BNB Smart Chain",
  description:
    "257,891 agents are registered on BSC. Eight of the ones we audited can actually be hired. GEBO measures which.",
};

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
