"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AnimatedBackground from "./AnimatedBackground";
import GradientHeading from "./GradientHeading";
import { DevelopmentBuildInfo } from "./ui/BuildInfo";
import { Session } from "next-auth";

const features = [
  {
    title: "Cryptographic Security",
    desc: "Every file is signed with Ed25519 cryptography, ensuring mathematical proof of authenticity and tamper-proof verification.",
    icon: "🔐",
    gradient: "from-blue-500 to-purple-600",
  },
  {
    title: "QR Code Sharing",
    desc: "Generate instant verification links and downloadable QR codes for seamless sharing and verification workflows.",
    icon: "📱",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    title: "Offline Verification",
    desc: "Verify signatures without internet connection. All cryptographic operations work locally in your browser.",
    icon: "🔒",
    gradient: "from-teal-500 to-emerald-500",
  },
];

const trustIndicators = [
  "Ed25519 Cryptography",
  "Zero Data Storage",
  "Open Source",
  "Local Processing",
];

interface LandingProps {
  authSection?: React.ReactNode;
  session?: Session | null;
}

export default function Landing({ authSection, session }: LandingProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Ensure we're on the client side
    if (typeof window !== "undefined") {
      console.log("Setting isHydrated to true");
      setIsHydrated(true);
    }

    // Fallback timeout in case hydration detection fails
    const timeout = setTimeout(() => {
      console.log("Fallback: forcing isHydrated to true after timeout");
      setIsHydrated(true);
    }, 2000);

    return () => clearTimeout(timeout);
  }, []);

  // Only determine sign-in status after hydration to prevent mismatch
  const isSignedIn = isHydrated && !!session;

  if (!mounted) {
    return null; // Prevent hydration mismatch
  }

  return (
    <main className="relative flex flex-col items-center w-full overflow-hidden min-h-screen">
      {/* Enhanced Animated Background */}
      <AnimatedBackground
        orbs={[
          "w-96 h-96 bg-gradient-to-br from-blue-400/20 to-purple-500/20 -top-32 -left-32",
          "w-80 h-80 bg-gradient-to-br from-purple-400/20 to-pink-500/20 top-1/4 -right-20",
          "w-72 h-72 bg-gradient-to-br from-teal-400/20 to-emerald-500/20 bottom-20 left-1/4",
          "w-64 h-64 bg-gradient-to-br from-emerald-400/15 to-blue-500/15 top-2/3 right-1/3",
        ]}
      />

      {/* Hero Section */}
      <section className="relative py-20 px-4 text-center max-w-6xl">
        {/* Security Badge */}
        <div className="inline-flex items-center gap-3 glass px-6 py-3 mb-8 group hover:scale-105 transition-all duration-300">
          <div className="relative">
            <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></div>
            <div className="absolute inset-0 w-3 h-3 bg-emerald-400 rounded-full animate-ping opacity-30"></div>
          </div>
          <span className="text-sm font-semibold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
            Secure • Ed25519 Verified • Zero Trust
          </span>
        </div>

        {/* Main Heading */}
        <div className="space-y-6 mb-12">
          <GradientHeading className="text-5xl md:text-7xl lg:text-8xl leading-tight">
            Content&nbsp;Proof
          </GradientHeading>

          <p className="text-xl md:text-2xl lg:text-3xl text-slate-600 max-w-4xl mx-auto leading-relaxed font-medium">
            Generate{" "}
            <span className="text-gradient font-bold">
              cryptographic signatures
            </span>{" "}
            for your digital assets and verify authenticity in seconds with
            mathematical certainty.
          </p>
        </div>

        {/* Enhanced Authentication Section */}
        <div className="mb-12">
          {isHydrated ? (
            <div className="flex flex-col items-center gap-4">
              {authSection}
              <p className="text-sm text-slate-500 max-w-md">
                {isSignedIn
                  ? "Ready to sign files with your verified identity"
                  : "Sign in with Google to start creating cryptographic signatures"}
              </p>
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="glass px-8 py-4 flex items-center gap-4">
                <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                <span className="text-slate-600 font-medium">
                  Loading authentication...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Enhanced Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          {!isHydrated ? (
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="btn-primary opacity-50 cursor-not-allowed flex items-center justify-center gap-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                Sign a file
              </div>
              <Link
                href="/verify"
                className="btn-secondary flex items-center justify-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Verify a signature
              </Link>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4">
              {isSignedIn ? (
                <Link
                  href="/upload"
                  className="btn-primary flex items-center justify-center gap-2 group"
                >
                  <svg
                    className="w-5 h-5 group-hover:scale-110 transition-transform"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  Sign a file
                </Link>
              ) : (
                <button
                  className="btn-primary opacity-60 cursor-not-allowed flex items-center justify-center gap-2"
                  disabled
                  title="Please sign in to upload files"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  Sign a file
                </button>
              )}
              <Link
                href="/verify"
                className="btn-secondary flex items-center justify-center gap-2 group"
              >
                <svg
                  className="w-5 h-5 group-hover:scale-110 transition-transform"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Verify a signature
              </Link>
            </div>
          )}
        </div>

        {/* Trust Indicators Bar */}
        <div className="flex flex-wrap justify-center gap-6 opacity-75">
          {trustIndicators.map((indicator, idx) => (
            <div
              key={indicator}
              className="flex items-center gap-2 text-sm text-slate-500"
            >
              <div className="w-2 h-2 bg-gradient-to-r from-emerald-400 to-blue-500 rounded-full"></div>
              <span className="font-medium">{indicator}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Enhanced Features Section */}
      <section className="w-full max-w-7xl px-6 py-20">
        <div className="text-center mb-16">
          <GradientHeading level={2} className="text-3xl md:text-4xl mb-4">
            Why Content Proof?
          </GradientHeading>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Built on cryptographic foundations that provide mathematical
            certainty for digital authenticity
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {features.map((feature, idx) => (
            <div
              key={feature.title}
              style={{ animationDelay: `${idx * 200}ms` }}
              className="card-feature group animate-float hover:animate-pulse-glow"
            >
              {/* Feature Icon with Gradient Background */}
              <div
                className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform duration-300 shadow-lg`}
              >
                <span className="filter drop-shadow-sm">{feature.icon}</span>
              </div>

              {/* Feature Content */}
              <h3 className="font-bold text-xl mb-4 text-slate-800 group-hover:text-blue-600 transition-colors">
                {feature.title}
              </h3>
              <p className="text-slate-600 leading-relaxed">{feature.desc}</p>

              {/* Hover Effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-purple-50/50 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10"></div>
            </div>
          ))}
        </div>
      </section>

      {/* Enhanced Trust Section */}
      <section className="w-full bg-gradient-to-r from-slate-50 to-blue-50 py-16 border-t border-slate-200">
        <div className="max-w-4xl mx-auto text-center px-6">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-blue-500 rounded-lg flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-slate-800">
              Industry Standard Security
            </h3>
          </div>

          <p className="text-slate-600 mb-8 max-w-2xl mx-auto leading-relaxed">
            Built with{" "}
            <span className="font-semibold text-blue-600">
              Ed25519 elliptic curve cryptography
            </span>
            , the same technology trusted by major platforms for secure
            authentication and digital signatures.
          </p>

          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <span className="px-4 py-2 bg-white/80 rounded-full border border-slate-200 text-slate-600 font-medium">
              🔐 256-bit Security
            </span>
            <span className="px-4 py-2 bg-white/80 rounded-full border border-slate-200 text-slate-600 font-medium">
              ⚡ Lightning Fast
            </span>
            <span className="px-4 py-2 bg-white/80 rounded-full border border-slate-200 text-slate-600 font-medium">
              🌐 Browser Native
            </span>
            <span className="px-4 py-2 bg-white/80 rounded-full border border-slate-200 text-slate-600 font-medium">
              🛡️ Zero Knowledge
            </span>
          </div>
        </div>
      </section>

      {/* Enhanced Footer */}
      <footer className="w-full mt-20 pt-12 pb-8 border-t border-slate-200 bg-gradient-to-r from-slate-50 to-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center space-y-6">
            <div className="flex justify-center gap-8 text-sm text-slate-500">
              <Link
                href="/privacy"
                className="hover:text-blue-600 transition-colors font-medium"
              >
                Privacy Policy
              </Link>
              <Link
                href="/how-it-works"
                className="hover:text-blue-600 transition-colors font-medium"
              >
                How It Works
              </Link>
            </div>

            <div className="text-xs text-slate-400">
              <p>
                © 2024 Content Proof. Securing digital authenticity through
                cryptography.
              </p>
            </div>

            <DevelopmentBuildInfo />
          </div>
        </div>
      </footer>
    </main>
  );
}
