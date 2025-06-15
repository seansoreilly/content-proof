"use client";

import React, { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { sha256Hash } from "@/lib/hash";
import { verifyEd25519Signature } from "@/lib/crypto/verify";
import { trackVerifySignature } from "@/lib/analytics";
import { useSession } from "next-auth/react";

interface SignatureData {
  signature: string;
  publicKey: string;
  timestamp: number;
}

function decodeSignatureData(encoded: string): SignatureData | null {
  try {
    // Add required padding and convert Base64URL → Base64
    const padding = encoded.length % 4 === 0 ? 0 : 4 - (encoded.length % 4);
    const base64 = (encoded + "=".repeat(padding))
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    let jsonStr: string;
    if (typeof window === "undefined") {
      // Node.js environment
      jsonStr = Buffer.from(base64, "base64").toString("utf8");
    } else {
      // Browser environment - properly decode UTF-8
      const binaryString = window.atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      jsonStr = new TextDecoder("utf-8").decode(bytes);
    }

    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("Failed to decode signature data", err);
    return null;
  }
}

function VerifyPageContent() {
  const searchParams = useSearchParams();
  const encodedData = searchParams.get("data") ?? "";

  const { data: session, status: authStatus } = useSession();

  const [sigData, setSigData] = useState<SignatureData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState<string>("");
  const [status, setStatus] = useState<
    "idle" | "verifying" | "success" | "failure" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [verificationTime, setVerificationTime] = useState<Date | null>(null);

  // Decode data on first render
  useEffect(() => {
    if (!encodedData) {
      setStatus("error");
      setMessage("Missing verification data in URL.");
      return;
    }

    const decoded = decodeSignatureData(encodedData);
    if (!decoded) {
      setStatus("error");
      setMessage("Invalid verification data.");
      return;
    }
    setSigData(decoded);

    // Cache public key for offline use
    try {
      localStorage.setItem("cached_ed25519_pub", decoded.publicKey);
    } catch {}
  }, [encodedData]);

  // Fallback to cached public key (offline)
  useEffect(() => {
    if (sigData && !sigData.publicKey) {
      try {
        const cached = localStorage.getItem("cached_ed25519_pub");
        if (cached) {
          setSigData({ ...sigData, publicKey: cached });
        }
      } catch {}
    }
  }, [sigData]);

  useEffect(() => {
    if (authStatus === "authenticated" && session?.user?.email) {
      setEmail(session.user.email);
    }
  }, [authStatus, session]);

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus("idle");
      setMessage(null);
    }
  };

  const verify = useCallback(async () => {
    if (!sigData) return;

    if (!file) {
      setMessage("Please select the original file.");
      setStatus("error");
      return;
    }
    if (!email.trim()) {
      setMessage("Please enter the Gmail address used during signing.");
      setStatus("error");
      return;
    }

    setStatus("verifying");
    setMessage(null);
    try {
      const fileHash = await sha256Hash(file);
      const signedMessage = `${fileHash}:${email.trim()}:${sigData.timestamp}`;
      const ok = verifyEd25519Signature(
        signedMessage,
        sigData.signature,
        sigData.publicKey
      );
      trackVerifySignature(ok ? "success" : "failure");
      setStatus(ok ? "success" : "failure");
      setMessage(
        ok
          ? "Signature verified successfully."
          : "Signature verification failed."
      );
      setVerificationTime(new Date());
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage("An unexpected error occurred during verification.");
    }
  }, [sigData, file, email]);

  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden p-4">
      {/* Enhanced Animated Background */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="animate-float w-72 h-72 bg-accent-blue/20 blur-3xl rounded-full absolute -top-24 -left-24" />
        <div className="animate-float w-64 h-64 bg-accent-purple/20 blur-3xl rounded-full absolute bottom-0 right-0" />
        <div className="animate-float w-48 h-48 bg-accent-teal/15 blur-3xl rounded-full absolute top-1/2 right-1/3" />
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

      {/* Centered Verification Icon with Glow Effect */}
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
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>
      </div>

      <h1 className="text-gradient-blue text-3xl md:text-5xl font-extrabold mb-8 bg-[length:200%_200%] bg-clip-text text-transparent animate-gradient-x text-center">
        Signature Verification
      </h1>

      {status === "error" && message && (
        <div className="glass p-4 border border-red-400/30 bg-red-400/20 backdrop-blur-sm max-w-md mb-6 animate-in fade-in duration-500">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-red-400 flex items-center justify-center">
              <svg
                className="w-3 h-3 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-red-400 font-medium text-center">{message}</p>
          </div>
        </div>
      )}

      {sigData && (
        <div className="glass p-6 w-full max-w-md space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="fileInput"
              className="block text-sm font-medium text-light-600"
            >
              Select Original File
            </label>
            <input
              id="fileInput"
              type="file"
              onChange={onFileChange}
              className="glass w-full px-3 py-2 text-light-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-gradient-to-r file:from-accent-blue file:to-accent-purple file:text-white hover:file:from-accent-purple hover:file:to-accent-teal transition-all duration-300"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="emailInput"
              className="block text-sm font-medium text-light-600"
            >
              Gmail Address
            </label>
            {authStatus === "authenticated" && session?.user?.email ? (
              <input
                id="emailInput"
                type="email"
                className="glass w-full px-3 py-2 cursor-not-allowed text-light-600 bg-white/10"
                value={session.user.email}
                disabled
                readOnly
              />
            ) : (
              <input
                id="emailInput"
                type="email"
                className="glass w-full px-3 py-2 text-light-600 focus:ring-2 focus:ring-accent-blue/50 focus:border-accent-blue/50 transition-all duration-300"
                placeholder="Enter Gmail address used during signing"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </div>

          <button
            className="btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2 relative overflow-hidden"
            disabled={status === "verifying"}
            onClick={verify}
          >
            {status === "verifying" && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            )}
            {status === "verifying" ? "Verifying…" : "Verify Signature"}
          </button>

          {status === "success" && message && (
            <div className="glass p-4 border border-green-400/30 bg-green-400/10 animate-in fade-in duration-500">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-400 flex items-center justify-center glow-green">
                  <svg
                    className="w-3 h-3 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <p className="text-green-400 font-medium">{message}</p>
              </div>
              {verificationTime && (
                <p className="text-light-500 text-sm mt-2 flex items-center gap-1">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Verified at {verificationTime.toLocaleString()}
                </p>
              )}
            </div>
          )}

          {status === "failure" && message && (
            <div className="glass-dark p-4 border border-red-400/30 animate-in fade-in duration-500">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-red-400 flex items-center justify-center">
                  <svg
                    className="w-3 h-3 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <p className="text-red-400 font-medium">{message}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Security Note */}
      <div className="mt-8 max-w-md text-center">
        <p className="text-sm text-light-500 flex items-center justify-center gap-2">
          <span className="text-lg">🔒</span>
          All verification happens locally in your browser. No files or data are
          transmitted to our servers.
        </p>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="glass p-8 flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin"></div>
            <span className="text-light-600">Loading verification...</span>
          </div>
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
