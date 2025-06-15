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
    <main className="flex flex-col items-center w-full">
      {/* Hero */}
      <section className="py-24 px-4 text-center max-w-4xl">
        <h1 className="text-4xl md:text-6xl font-extrabold mb-6">
          Content&nbsp;Proof
        </h1>
        <p className="text-lg md:text-2xl text-gray-600 mb-8">
          Generate cryptographic signatures for your digital assets and verify
          authenticity in seconds.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/upload"
            className="px-6 py-3 rounded bg-blue-600 text-white font-medium"
          >
            Sign a file
          </Link>
          <Link
            href="/verify"
            className="px-6 py-3 rounded border border-gray-300 text-gray-800"
          >
            Verify signature
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="grid gap-8 md:grid-cols-3 px-6 pb-24 max-w-6xl">
        {features.map((f) => (
          <div
            key={f.title}
            className="p-6 bg-gray-50 rounded border border-gray-100 shadow-sm"
          >
            <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
            <p className="text-sm text-gray-700">{f.desc}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
