"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { QrCodeGenerator } from "@/components/QrCodeGenerator";
import { sha256Hash } from "@/lib/hash";
import { trackSignFile } from "@/lib/analytics";

interface HashResult {
  fileName: string;
  fileSize: number;
  hash: string;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/x-zip-compressed",
];

export default function FileUpload() {
  const [dragActive, setDragActive] = useState(false);
  const [hashResult, setHashResult] = useState<HashResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [signature, setSignature] = useState<
    import("@/lib/crypto/ed25519").SignatureData | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Only show sensitive hash details in development or when explicitly enabled
  const isDebug = process.env.NODE_ENV === "development";

  const resetState = () => {
    setHashResult(null);
    setError(null);
    setPreviewUrl(null);
    setSignature(null);
    setCopied(false);
    setProgress(0);
  };

  const validateFile = (file: File) => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `Unsupported file type: ${file.type}. Please use PNG, JPEG, GIF, PDF, TXT, or ZIP files.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File size (${(file.size / (1024 * 1024)).toFixed(
        2,
      )} MB) exceeds the ${(MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(
        0,
      )} MB limit.`;
    }
    return null;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    resetState();

    const file = files[0]; // single file
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (file.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(file));
    }

    setLoading(true);
    try {
      console.log(
        `Starting file hash generation for: ${file.name} (${file.size} bytes)`,
      );

      // Simulate progress for UX
      setProgress(25);

      const hash = await sha256Hash(file);
      console.log(`Generated hash: ${hash}`);
      setHashResult({ fileName: file.name, fileSize: file.size, hash });
      setProgress(50);

      console.log("Initiating signature request to /api/sign");
      setProgress(75);

      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileHash: hash }),
      });

      if (!res.ok) {
        console.error(`Signature API failed with status: ${res.status}`);
        throw new Error(`Signature API error: ${res.status}`);
      }

      const data =
        (await res.json()) as import("@/lib/crypto/ed25519").SignatureData;
      console.log("Successfully received signature data");
      setSignature(data);
      setProgress(100);

      console.log("Tracking file signing event");
      trackSignFile();
    } catch (err) {
      console.error("File signing process failed:", err);
      setError("Failed to generate signature. Please try again.");
    } finally {
      console.log("File signing process completed");
      setLoading(false);
      setTimeout(() => setProgress(0), 1000);
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
    handleFiles(e.dataTransfer.files);
  };

  const onButtonClick = () => {
    inputRef.current?.click();
  };

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    handleFiles(e.target.files);
  };

  const copyToClipboard = async (text: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }

      // Fallback for older browsers or when clipboard API is blocked
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (successful) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error("Fallback copy failed");
      }
    } catch (err) {
      console.error("Failed to copy:", err);
      // Show a brief error message instead of failing silently
      alert("Copy failed. Please manually copy the text.");
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Enhanced Drag & Drop Zone */}
      <div
        className={`drop-zone cursor-pointer group ${
          dragActive ? "active" : ""
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={onButtonClick}
      >
        <input
          id="fileInput"
          type="file"
          ref={inputRef}
          className="hidden"
          onChange={onFileChange}
          accept={ALLOWED_MIME_TYPES.join(",")}
          aria-label="Select file to sign"
        />

        {/* Upload Icon */}
        <div
          className={`relative mb-6 ${dragActive ? "animate-pulse-glow" : ""}`}
        >
          <div
            className={`w-20 h-20 mx-auto rounded-3xl flex items-center justify-center transition-all duration-300 ${
              dragActive
                ? "bg-gradient-to-br from-blue-500 to-purple-600 scale-110 shadow-xl"
                : "bg-gradient-to-br from-blue-500/80 to-purple-600/80 shadow-lg group-hover:scale-105"
            }`}
          >
            <svg
              className="w-10 h-10 text-white"
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

          {/* Floating elements for visual appeal */}
          <div className="absolute -top-2 -right-2 w-4 h-4 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full opacity-60 group-hover:opacity-100 transition-opacity"></div>
          <div className="absolute -bottom-1 -left-1 w-3 h-3 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full opacity-40 group-hover:opacity-80 transition-opacity"></div>
        </div>

        {/* Upload Text */}
        <div className="text-center space-y-3">
          <h3
            className={`font-bold text-xl transition-all duration-300 ${
              dragActive
                ? "text-gradient scale-105"
                : "text-slate-700 group-hover:text-gradient"
            }`}
          >
            {dragActive ? "Drop your file here" : "Drag & drop your file"}
          </h3>

          <p className="text-slate-500">
            or{" "}
            <span className="font-semibold text-blue-600 hover:text-purple-600 transition-colors">
              browse to select
            </span>
          </p>

          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {["PNG", "JPEG", "PDF", "TXT", "ZIP"].map((type) => (
              <span
                key={type}
                className="px-3 py-1 text-xs font-medium bg-gradient-to-r from-blue-50 to-purple-50 text-blue-600 rounded-full border border-blue-200"
              >
                {type}
              </span>
            ))}
          </div>

          <p className="text-xs text-slate-400 flex items-center justify-center gap-2">
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
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Maximum file size: 10MB
          </p>
        </div>
      </div>

      {/* Enhanced Loading State */}
      {loading && (
        <div className="glass mt-6 p-6 space-y-4">
          <div className="flex items-center justify-center gap-4">
            <div className="relative">
              <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 w-8 h-8 border-3 border-transparent border-t-purple-600 rounded-full animate-spin animation-delay-75 opacity-60"></div>
            </div>
            <p className="text-gradient font-semibold">
              Generating cryptographic signature...
            </p>
          </div>

          {/* Progress Bar */}
          <div className="relative">
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <div className="absolute inset-0 h-2 bg-gradient-to-r from-blue-300/50 to-purple-300/50 rounded-full animate-shimmer"></div>
          </div>

          <div className="text-center text-sm text-slate-500">
            <div className="flex items-center justify-center gap-2">
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
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              Processing locally in your browser - no data uploaded
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Error Display */}
      {error && (
        <div className="status-error mt-6 animate-in fade-in duration-500">
          <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-4 h-4 text-white"
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
          <div>
            <p className="font-semibold">Upload Error</p>
            <p className="text-sm opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Enhanced Preview Display */}
      {previewUrl && (
        <details className="glass mt-6 p-6 group">
          <summary className="cursor-pointer font-semibold mb-4 text-slate-700 flex items-center gap-3 select-none group-open:mb-6">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            </div>
            <span>File Preview</span>
            <span className="text-sm text-slate-500">(click to toggle)</span>
          </summary>
          <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50 p-4">
            <Image
              src={previewUrl}
              alt="File preview"
              width={400}
              height={300}
              className="max-h-80 w-full object-contain rounded-xl shadow-lg"
            />
          </div>
        </details>
      )}

      {/* Enhanced Hash Result Display */}
      {hashResult && (
        <div className="status-success mt-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
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
            <div>
              <p className="font-bold text-emerald-700">File Hash Generated</p>
              <p className="text-sm text-emerald-600">
                Cryptographic fingerprint created
              </p>
            </div>
          </div>

          <div className="bg-white/50 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-500 font-medium">Filename:</span>
                <p
                  className="font-semibold text-slate-700 truncate"
                  title={hashResult.fileName}
                >
                  {hashResult.fileName}
                </p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">Size:</span>
                <p className="font-semibold text-slate-700">
                  {(hashResult.fileSize / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>

            {isDebug && (
              <details className="pt-2 border-t border-slate-200">
                <summary className="cursor-pointer text-sm font-medium text-slate-600 select-none hover:text-blue-600 transition-colors">
                  SHA-256 Hash Details
                </summary>
                <div className="relative mt-3">
                  <div className="glass p-4 rounded-xl font-mono text-xs text-slate-600 break-all pr-12 bg-gradient-to-r from-blue-50 to-purple-50">
                    {hashResult.hash}
                  </div>
                  <button
                    onClick={() => copyToClipboard(hashResult.hash)}
                    className={`absolute top-2 right-2 p-2 rounded-lg transition-all duration-200 ${
                      copied
                        ? "bg-emerald-500 text-white scale-110"
                        : "bg-white/80 text-slate-500 hover:bg-blue-500 hover:text-white hover:scale-105"
                    }`}
                    title={copied ? "Copied!" : "Copy hash"}
                  >
                    {copied ? (
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
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
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Enhanced QR Code Display */}
      {signature && (
        <div className="glass mt-6 p-6 space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM12 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1V4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <p className="font-bold text-purple-700">Verification Ready</p>
              <p className="text-sm text-purple-600">
                QR code and signature generated
              </p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-4">
            <QrCodeGenerator signature={signature} />
          </div>
        </div>
      )}
    </div>
  );
}
