import type { Metadata } from "next";
import { Bricolage_Grotesque, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/SessionProvider";
import Script from "next/script";
import { GA_TRACKING_ID, gaInitScript } from "@/lib/analytics";
import Link from "next/link";
import { DevelopmentBuildInfo, SealMark } from "@/components/ui";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});

const body = Source_Serif_4({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const DESCRIPTION =
  "A notary for files. Your browser hashes a file and signs it, ContentProof countersigns who, what and when, and anyone can verify the seal.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.contentproof.app"),
  title: { default: "ContentProof", template: "%s – ContentProof" },
  description: DESCRIPTION,
  openGraph: {
    title: "ContentProof",
    description: DESCRIPTION,
    siteName: "ContentProof",
    type: "website",
    url: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="font-body bg-paper text-ink">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4">
          <Link href="/" className="-my-2 flex items-center gap-3 py-2 text-ink">
            <SealMark tone="sealed" size={28} label="CP" />
            <span className="font-display font-semibold uppercase tracking-[0.12em]">
              ContentProof
            </span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-mute">
            <Link href="/how-it-works" className="-my-2 py-3 hover:text-ink">
              How it works
            </Link>
            <Link href="/privacy" className="-my-2 py-3 hover:text-ink">
              Privacy
            </Link>
          </nav>
        </header>
        {/* Google Analytics */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">
          {gaInitScript()}
        </Script>
        <AuthProvider>
          <main className="min-h-screen">{children}</main>
        </AuthProvider>
        <footer className="px-4 py-8 text-center text-xs text-mute">
          <DevelopmentBuildInfo />
          <p className="font-mono text-mute">
            Keys at /.well-known/public-keys.json
          </p>
        </footer>
      </body>
    </html>
  );
}
