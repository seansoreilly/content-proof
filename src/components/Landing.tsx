"use client";

import Link from "next/link";

const features = [
  {
    title: "Secure Signatures",
    desc: "Every file is signed with Ed25519 ensuring tamper-proof authenticity.",
  },
  {
    title: "QR Code Sharing",
    desc: "Share verification data instantly via downloadable QR codes.",
  },
  {
    title: "Offline Verification",
    desc: "Verification works even without an internet connection.",
  },
];

export default function Landing() {
  return (
    <main className="relative flex flex-col items-center w-full overflow-hidden">
      {/* Animated Background Orbs */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="animate-float w-72 h-72 bg-accent-blue/20 blur-3xl rounded-full absolute -top-20 -left-20" />
        <div className="animate-float w-96 h-96 bg-accent-purple/20 blur-3xl rounded-full absolute top-1/3 right-0" />
        <div className="animate-float w-64 h-64 bg-accent-teal/20 blur-3xl rounded-full absolute bottom-0 left-1/4" />
      </div>

      {/* Hero */}
      <section className="py-32 px-4 text-center max-w-4xl">
        <h1 className="text-gradient-blue text-4xl md:text-6xl font-extrabold mb-6 animate-gradient-x bg-[length:200%_200%] bg-clip-text text-transparent">
          Content&nbsp;Proof
        </h1>
        <p className="text-lg md:text-2xl text-light-600 mb-8 max-w-2xl mx-auto">
          Generate cryptographic signatures for your digital assets and verify
          authenticity in seconds.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/upload" className="btn-primary">
            Sign a file
          </Link>
          <Link href="/verify" className="btn-secondary">
            Verify signature
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
          Built with industry standard Ed25519 signatures &bull; All
          verifications occur locally &bull; No data stored on our servers
        </p>
      </section>
    </main>
  );
}
