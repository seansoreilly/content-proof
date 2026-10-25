import type { Metadata } from "next";
import { Bricolage_Grotesque, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/SessionProvider";
import Script from "next/script";
import { GA_TRACKING_ID } from "@/lib/analytics";
import Link from "next/link";

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

export const metadata: Metadata = {
  title: "Content Proof",
  description:
    "A notary for files. Your browser hashes a file and signs it, ContentProof countersigns who, what and when, and anyone can verify the seal.",
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
        {/* Top Right Navigation */}
        <header className="absolute top-6 right-6 z-50 flex items-center gap-4 text-sm text-mute">
          <Link href="/privacy" className="hover:underline">
            Privacy Policy
          </Link>
          <span className="text-relief">|</span>
          <Link href="/how-it-works" className="hover:underline">
            How it works
          </Link>
        </header>
        {/* Google Analytics */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_TRACKING_ID}');
          `}
        </Script>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
