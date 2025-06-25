"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AnimatedBackground from "./AnimatedBackground";
import GradientHeading from "./GradientHeading";
import { DevelopmentBuildInfo } from "./ui/BuildInfo";
import { Session } from "next-auth";

const features = [
  {
    title: "Secure Signatures",
    desc: "Every file is signed with Ed25519 ensuring tamper-proof authenticity.",
    icon: "🔐",
  },
  {
    title: "QR Code Sharing",
    desc: "Share verification data instantly via downloadable QR codes.",
    icon: "📱",
  },
  {
    title: "Offline Verification",
    desc: "Verification works even without an internet connection.",
    icon: "🔒",
  },
];

interface LandingProps {
  authSection?: React.ReactNode;
  session?: Session | null;
}

export default function Landing({ authSection, session }: LandingProps) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Only determine sign-in status after hydration to prevent mismatch
  const isSignedIn = isHydrated && !!session;

  return (
    <main className="relative flex flex-col items-center w-full overflow-hidden">
      {/* Animated Background Orbs */}
      <AnimatedBackground
        orbs={[
          "w-72 h-72 bg-accent-blue/20 -top-20 -left-20",
          "w-96 h-96 bg-accent-purple/20 top-1/3 right-0",
          "w-64 h-64 bg-accent-teal/20 bottom-0 left-1/4",
        ]}
      />

      {/* Hero */}
      <section className="py-32 px-4 text-center max-w-4xl">
        {/* Security Badge */}
        <div className="inline-flex items-center gap-2 glass px-4 py-2 mb-6">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse-slow"></div>
          <span className="text-sm text-light-600 font-medium">
            Secure • Ed25519 Verified
          </span>
        </div>

        <GradientHeading className="text-4xl md:text-6xl mb-6">
          Content&nbsp;Proof
        </GradientHeading>
        <p className="text-lg md:text-2xl text-dark-blue-400 mb-8 max-w-2xl mx-auto">
          Generate cryptographic signatures for your digital assets and verify
          authenticity in seconds.
        </p>

        {/* Authentication Section */}
        <div className="mb-8">
          {!isHydrated ? (
            <div className="flex justify-center">
              <div className="glass px-6 py-3 flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin"></div>
                <span className="text-light-600">Loading...</span>
              </div>
            </div>
          ) : (
            authSection
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {!isHydrated ? (
            // Show placeholder during hydration to prevent mismatch
            <button
              className="btn-primary opacity-50 cursor-not-allowed"
              disabled
            >
              Sign a file
            </button>
          ) : isSignedIn ? (
            <Link href="/upload" className="btn-primary">
              Sign a file
            </Link>
          ) : (
            <button
              className="btn-primary opacity-50 cursor-not-allowed"
              disabled
              title="Please sign in to upload files"
            >
              Sign a file
            </button>
          )}
          <Link href="/verify" className="btn-secondary">
            Verify a file
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="grid gap-8 md:grid-cols-3 px-6 pb-32 max-w-6xl">
        {features.map((f, idx) => (
          <div
            key={f.title}
            style={{ animationDelay: `${idx * 200}ms` }}
            className="glass p-6 card-hover animate-float"
          >
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="font-semibold text-lg mb-2 text-light-600">
              {f.title}
            </h3>
            <p className="text-sm text-light-500">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Trust Indicators */}
      <section className="w-full bg-white/5 backdrop-blur-sm py-12 border-t border-white/10">
        <p className="text-center text-sm text-light-500">
          Built with industry standard Ed25519 signatures
        </p>
      </section>

      {/* Footer with Links & Build Info */}
      <footer className="mt-16 pt-8 border-t border-gray-200 space-y-4 text-center">
        <div className="flex justify-center gap-4 text-sm text-light-500"></div>
        <DevelopmentBuildInfo />
      </footer>
    </main>
  );
}
