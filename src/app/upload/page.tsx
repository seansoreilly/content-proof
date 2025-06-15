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

      <h1 className="text-gradient-blue text-3xl md:text-5xl font-extrabold mb-8 bg-[length:200%_200%] bg-clip-text text-transparent animate-gradient-x text-center">
        Sign a File
      </h1>

      <div className="glass w-full max-w-lg">
        <FileUpload />
      </div>

      {/* Security Note */}
      <div className="mt-8 max-w-lg text-center">
        <p className="text-sm text-light-500">
          🔒 Your files are processed locally and never stored on our servers.
          Only cryptographic signatures are generated for verification.
        </p>
      </div>
    </main>
  );
}
