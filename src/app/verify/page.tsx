"use client";

import React, { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage("An unexpected error occurred during verification.");
    }
  }, [sigData, file, email]);

  return (
    <main className="flex flex-col items-center gap-4 min-h-screen p-4">
      <h1 className="text-2xl font-bold">Signature Verification</h1>

      {status === "error" && message && (
        <p className="text-red-600 font-medium max-w-md text-center">
          {message}
        </p>
      )}

      {sigData && (
        <>
          <input type="file" onChange={onFileChange} />

          {authStatus === "authenticated" && session?.user?.email ? (
            <input
              type="email"
              className="border rounded px-3 py-2 bg-gray-100 cursor-not-allowed"
              value={session.user.email}
              disabled
              readOnly
            />
          ) : (
            <input
              type="email"
              className="border rounded px-3 py-2"
              placeholder="Gmail address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}

          <button
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
            disabled={status === "verifying"}
            onClick={verify}
          >
            {status === "verifying" ? "Verifying…" : "Verify"}
          </button>

          {status !== "idle" && status !== "verifying" && message && (
            <p
              className={`font-medium max-w-md text-center ${
                status === "success" ? "text-green-600" : "text-red-600"
              }`}
            >
              {message}
            </p>
          )}
        </>
      )}
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          Loading...
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
