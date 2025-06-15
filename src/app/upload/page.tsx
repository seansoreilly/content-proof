"use client";

import FileUpload from "../../components/FileUpload";
import Link from "next/link";

export default function UploadPage() {
  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden p-4">
      {/* Animated Background */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="animate-float w-80 h-80 bg-accent-purple/20 blur-3xl rounded-full absolute -top-20 left-1/2 -translate-x-1/2" />
        <div className="animate-float w-56 h-56 bg-accent-teal/20 blur-3xl rounded-full absolute bottom-10 right-10" />
        <div className="animate-float w-64 h-64 bg-accent-blue/15 blur-3xl rounded-full absolute top-1/3 -left-20" />
      </div>

      {/* Back Navigation */}
      <div className="absolute top-6 left-6">
        <Link
          href="/"
          aria-label="Back to home"
          className="btn-secondary backdrop-blur-xs"
        >
          ← Home
        </Link>
      </div>

      {/* Centered Icon with Glow Effect */}
      <div className="mb-6">
        <div className="relative">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-2xl bg-gradient-to-br from-accent-blue to-accent-purple glow-blue">
            <svg
              className="w-8 h-8 text-white"
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
        </div>
      </div>

      <h1 className="text-gradient-blue text-3xl md:text-5xl font-extrabold mb-8 bg-[length:200%_200%] bg-clip-text text-transparent animate-gradient-x text-center">
        Sign a File
      </h1>

      <div className="glass w-full max-w-lg">
        <FileUpload />
      </div>

      {/* Security Note */}
      <div className="mt-8 max-w-lg text-center">
        <p className="text-sm text-light-500 flex items-center justify-center gap-2">
          <span className="text-lg">🔒</span>
          Your files are processed locally and never stored on our servers. Only
          cryptographic signatures are generated for verification.
        </p>
      </div>
    </main>
  );
}
