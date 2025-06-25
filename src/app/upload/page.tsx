"use client";

import FileUpload from "../../components/FileUpload";
import Link from "next/link";
import AnimatedBackground from "../../components/AnimatedBackground";
import GradientHeading from "../../components/GradientHeading";

export default function UploadPage() {
  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden px-4 py-8">
      {/* Enhanced Animated Background */}
      <AnimatedBackground
        orbs={[
          "w-96 h-96 bg-gradient-to-br from-blue-400/20 to-purple-500/20 -top-40 left-1/2 -translate-x-1/2",
          "w-72 h-72 bg-gradient-to-br from-emerald-400/20 to-teal-500/20 bottom-20 right-20",
          "w-80 h-80 bg-gradient-to-br from-purple-400/15 to-pink-500/15 top-1/3 -left-32",
          "w-64 h-64 bg-gradient-to-br from-teal-400/15 to-blue-500/15 bottom-1/3 right-1/4",
        ]}
      />

      {/* Enhanced Back Navigation */}
      <div className="absolute top-6 left-6 z-10">
        <Link
          href="/"
          aria-label="Back to home"
          className="btn-secondary flex items-center gap-2 group"
        >
          <svg
            className="w-4 h-4 group-hover:-translate-x-1 transition-transform"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Home
        </Link>
      </div>

      {/* Enhanced Header Section */}
      <header className="text-center mb-12 max-w-4xl">
        {/* Icon with Enhanced Styling */}
        <div className="mb-8">
          <div className="relative inline-block">
            <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-blue-600 to-purple-700 shadow-2xl flex items-center justify-center group-hover:scale-110 transition-all duration-300">
              <svg
                className="w-12 h-12 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                />
              </svg>
            </div>

            {/* Floating decorative elements */}
            <div className="absolute -top-3 -right-3 w-6 h-6 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full opacity-80 animate-float"></div>
            <div
              className="absolute -bottom-2 -left-2 w-4 h-4 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full opacity-60 animate-float"
              style={{ animationDelay: "1s" }}
            ></div>
          </div>
        </div>

        <div className="space-y-6">
          <GradientHeading className="text-4xl md:text-6xl lg:text-7xl leading-tight">
            Sign Your File
          </GradientHeading>

          <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Create a{" "}
            <span className="font-bold text-gradient">
              cryptographic signature
            </span>{" "}
            for your digital file. Generate mathematical proof of authenticity
            that can be verified anywhere, anytime.
          </p>

          {/* Feature highlights */}
          <div className="flex flex-wrap justify-center gap-4 mt-8">
            <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full border border-blue-200">
              <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
              <span className="text-sm font-medium text-slate-600">
                Local Processing
              </span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full border border-purple-200">
              <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
              <span className="text-sm font-medium text-slate-600">
                Ed25519 Secure
              </span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full border border-teal-200">
              <div className="w-2 h-2 bg-teal-400 rounded-full"></div>
              <span className="text-sm font-medium text-slate-600">
                Instant QR Code
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Enhanced Upload Section */}
      <section className="w-full max-w-2xl">
        <FileUpload />
      </section>

      {/* Enhanced Security Notice */}
      <footer className="mt-12 max-w-2xl text-center">
        <div className="glass p-6 rounded-2xl">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-blue-600 rounded-full flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-slate-700">
              Complete Privacy
            </h3>
          </div>

          <div className="space-y-3 text-sm text-slate-600">
            <p className="flex items-center justify-center gap-2">
              <svg
                className="w-4 h-4 text-emerald-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Files processed locally in your browser
            </p>
            <p className="flex items-center justify-center gap-2">
              <svg
                className="w-4 h-4 text-emerald-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              No files uploaded to our servers
            </p>
            <p className="flex items-center justify-center gap-2">
              <svg
                className="w-4 h-4 text-emerald-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Only cryptographic signatures generated
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
