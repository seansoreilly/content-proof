"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { QrCodeGenerator } from "@/components/QrCodeGenerator";
import { MAX_FILE_SIZE_BYTES, sha256Hash } from "@/lib/hash";
import { buildSignedMessage, parseRecordObject, type SignatureRecord } from "@/lib/record";
import { getOrCreateUserKey, type UserSigningKey } from "@/lib/user-keys";
import { trackSignFile } from "@/lib/analytics";

interface HashResult {
  fileName: string;
  fileSize: number;
  hash: string;
}

const MAX_FILE_SIZE_LABEL = `${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB`;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

export default function FileUpload() {
  const [dragActive, setDragActive] = useState(false);
  const [hashResult, setHashResult] = useState<HashResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "hashing" | "signing">("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [record, setRecord] = useState<SignatureRecord | null>(null);
  const [userKey, setUserKey] = useState<UserSigningKey | null | "unsupported">(null);
  const { data: session } = useSession();

  const inputRef = useRef<HTMLInputElement | null>(null);

  // This browser's own signing key (created on first use, never leaves the device).
  useEffect(() => {
    let cancelled = false;
    getOrCreateUserKey()
      .then((key) => {
        if (!cancelled) setUserKey(key);
      })
      .catch(() => {
        if (!cancelled) setUserKey("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetState = () => {
    setHashResult(null);
    setError(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setRecord(null);
  };

  // Any file type is fine: only its hash leaves the browser. The size cap is a
  // sanity bound, not a memory limit, because hashing is streamed.
  const validateFile = (file: File): string | null => {
    if (file.size === 0) return "The selected file is empty.";
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `Files larger than ${MAX_FILE_SIZE_LABEL} are not supported.`;
    }
    return null;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    resetState();

    const file = files[0];
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (file.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(file));
    }

    try {
      setStage("hashing");
      const hash = await sha256Hash(file);
      setHashResult({ fileName: file.name, fileSize: file.size, hash });

      setStage("signing");
      // Sign with this browser's key first so the service can countersign a
      // statement the account holder actually made. Falls back to a
      // service-only record when the browser cannot hold a key.
      let payload: Record<string, unknown> = { fileHash: hash };
      const email = session?.user?.email;
      if (userKey && userKey !== "unsupported" && email) {
        const timestamp = Date.now();
        const userSignature = await userKey.sign(buildSignedMessage(hash, email, timestamp));
        payload = { fileHash: hash, timestamp, userPublicKey: userKey.publicKey, userSignature };
      }
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) throw new Error("Please sign in before signing a file.");
      if (res.status === 429) throw new Error("Too many signing requests. Please wait a minute and try again.");
      if (!res.ok) throw new Error(`Signing failed (${res.status}).`);

      const body = (await res.json()) as { record?: unknown };
      const signed = parseRecordObject(body.record);
      if (!signed) throw new Error("The server returned an unexpected response.");
      setRecord(signed);
      trackSignFile();
    } catch (err) {
      console.error("File signing failed:", err);
      setError(err instanceof Error ? err.message : "Failed to generate signature.");
    } finally {
      setStage("idle");
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void handleFiles(e.dataTransfer.files);
  };

  const onButtonClick = () => {
    inputRef.current?.click();
  };

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    void handleFiles(e.target.files);
  };

  const busy = stage !== "idle";

  return (
    <div className="w-full max-w-lg mx-auto p-4">
      <div
        className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 backdrop-blur-sm relative overflow-hidden ${
          dragActive
            ? "border-accent-blue bg-accent-blue/10 scale-105 glow-blue"
            : "border-white/30 bg-white/5 hover:border-accent-purple/50 hover:bg-white/10"
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={onButtonClick}
      >
        <input id="fileInput" type="file" ref={inputRef} className="hidden" onChange={onFileChange} />

        <div
          className={`w-12 h-12 mb-4 rounded-full flex items-center justify-center transition-all duration-300 ${
            dragActive ? "bg-accent-blue/20 scale-110" : "bg-white/10"
          }`}
        >
          <svg
            className={`w-6 h-6 transition-colors duration-300 ${dragActive ? "text-accent-blue" : "text-light-500"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        <p className="text-light-600 text-center mb-2">
          <span className="font-semibold text-accent-blue">
            {dragActive ? "Drop your file here" : "Drag & drop a file here"}
          </span>
        </p>

        <p className="text-light-500 text-sm text-center">
          or <span className="font-semibold text-accent-blue hover:text-accent-purple transition-colors">browse files</span>
        </p>

        <p className="text-xs text-light-400 mt-2 text-center">
          Any file type up to {MAX_FILE_SIZE_LABEL}. The file never leaves your browser; only its
          fingerprint is sent.
        </p>
      </div>

      {busy && (
        <div className="glass mt-4 p-4 flex items-center justify-center gap-3">
          <div className="w-5 h-5 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin"></div>
          <p className="text-accent-blue font-medium">
            {stage === "hashing" ? "Fingerprinting your file…" : "Requesting attestation…"}
          </p>
        </div>
      )}

      {error && (
        <div className="glass mt-4 p-4 border border-red-400/30 bg-red-400/10">
          <p className="text-red-400 font-medium">{error}</p>
        </div>
      )}

      {previewUrl && (
        <details className="glass mt-4 p-4">
          <summary className="cursor-pointer font-medium text-light-600 select-none">Preview</summary>
          <div className="relative rounded-lg overflow-hidden mt-4">
            <Image
              src={previewUrl}
              alt="File preview"
              width={256}
              height={256}
              unoptimized
              className="max-h-64 w-full object-contain bg-white/5 rounded-lg"
            />
          </div>
        </details>
      )}

      {hashResult && (
        <div className="glass mt-4 p-4 space-y-2 text-sm">
          <div className="flex justify-between items-center gap-4">
            <span className="text-light-500">File</span>
            <span className="font-medium text-light-600 truncate">{hashResult.fileName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-light-500">Size</span>
            <span className="font-medium text-light-600">{formatSize(hashResult.fileSize)}</span>
          </div>
          <details>
            <summary className="cursor-pointer text-light-500 select-none">SHA-256 fingerprint</summary>
            <code className="block mt-2 p-3 rounded-lg font-mono text-xs text-light-600 break-all bg-white/5">
              {hashResult.hash}
            </code>
          </details>
        </div>
      )}

      {record && (
        <div className="glass mt-4 p-4">
          <p className="font-medium text-accent-purple mb-4">Verification QR code</p>
          <QrCodeGenerator record={record} />
        </div>
      )}

      <div className="glass mt-4 p-4 text-xs text-light-500 space-y-1" data-testid="user-key">
        {userKey === "unsupported" ? (
          <p>
            This browser cannot hold a signing key, so records are service attestations only. A current
            Chrome, Firefox or Safari adds your own signature.
          </p>
        ) : userKey ? (
          <>
            <p className="text-light-600 font-medium">Your signing key (this browser)</p>
            <code className="block break-all">{userKey.publicKey}</code>
            <p>
              Records you create here carry a signature made with this key. It never leaves this device.
              Publish this key where people can find you so they can tie your records to you, not just to
              your account.
            </p>
          </>
        ) : (
          <p>Preparing your signing key…</p>
        )}
      </div>
    </div>
  );
}
