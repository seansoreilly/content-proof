import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/SessionProvider";
import Script from "next/script";
import { GA_TRACKING_ID } from "@/lib/analytics";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Content Proof",
  description: "Secure your files",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* Top Right Navigation */}
        <header className="absolute top-6 right-6 z-50 flex items-center gap-4 text-sm text-light-500">
          <Link href="/privacy" className="hover:underline">
            Privacy Policy
          </Link>
          <span className="text-light-600">|</span>
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
