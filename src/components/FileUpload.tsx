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

  const inputRef = useRef<HTMLInputElement | null>(null);

  const resetState = () => {
    setHashResult(null);
    setError(null);
    setPreviewUrl(null);
    setSignature(null);
    setCopied(false);
  };

  const validateFile = (file: File) => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `Unsupported file type: ${file.type}`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File larger than ${(MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(
        2
      )} MB is not allowed`;
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
        `Starting file hash generation for: ${file.name} (${file.size} bytes)`
      );
      const hash = await sha256Hash(file);
      console.log(`Generated hash: ${hash}`);
      setHashResult({ fileName: file.name, fileSize: file.size, hash });

      console.log("Initiating signature request to /api/sign");
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

      console.log("Tracking file signing event");
      trackSignFile();
    } catch (err) {
      console.error("File signing process failed:", err);
      setError("Failed to generate signature.");
    } finally {
      console.log("File signing process completed");
      setLoading(false);
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
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto p-4">
      {/* Enhanced Drag & Drop Zone */}
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
        <input
          id="fileInput"
          type="file"
          ref={inputRef}
          className="hidden"
          onChange={onFileChange}
        />

        {/* Upload Icon */}
        <div
          className={`w-12 h-12 mb-4 rounded-full flex items-center justify-center transition-all duration-300 ${
            dragActive ? "bg-accent-blue/20 scale-110" : "bg-white/10"
          }`}
        >
          <svg
            className={`w-6 h-6 transition-colors duration-300 ${
              dragActive ? "text-accent-blue" : "text-light-500"
            }`}
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
          <span
            className={`font-semibold transition-colors duration-300 ${
              dragActive ? "text-accent-blue" : "text-accent-blue"
            }`}
          >
            {dragActive ? "Drop your file here" : "Drag & drop a file here"}
          </span>
        </p>

        <p className="text-light-500 text-sm text-center">
          or{" "}
          <span className="font-semibold text-accent-blue hover:text-accent-purple transition-colors cursor-pointer">
            browse files
          </span>
        </p>

        <p className="text-xs text-light-400 mt-2 text-center">
          Supports PNG, JPEG, GIF, PDF, TXT, ZIP (max 10MB)
        </p>
      </div>

      {/* Loading State with Enhanced Spinner */}
      {loading && (
        <div className="glass mt-4 p-4 flex items-center justify-center gap-3">
          <div className="w-5 h-5 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin"></div>
          <p className="text-accent-blue font-medium">
            Generating cryptographic signature...
          </p>
        </div>
      )}

      {/* Enhanced Error Display */}
      {error && (
        <div className="glass-dark mt-4 p-4 border border-red-400/30 bg-red-400/10">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-red-400 flex items-center justify-center">
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
            <p className="text-red-400 font-medium">Error: {error}</p>
          </div>
        </div>
      )}

      {/* Enhanced Preview Display */}
      {previewUrl && (
        <div className="glass mt-4 p-4">
          <p className="font-medium mb-3 text-light-600 flex items-center gap-2">
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
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
            Preview
          </p>
          <div className="relative rounded-lg overflow-hidden">
            <Image
              src={previewUrl}
              alt="File preview"
              width={256}
              height={256}
              className="max-h-64 w-full object-contain bg-white/5 rounded-lg"
            />
          </div>
        </div>
      )}

      {/* Enhanced Hash Result Display */}
      {hashResult && (
        <div className="glass mt-4 p-4 space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full bg-green-400 flex items-center justify-center">
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
            <p className="font-medium text-green-400">File Hash Generated</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-light-500">File:</span>
              <span className="font-medium text-light-600 truncate ml-2">
                {hashResult.fileName}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-light-500">Size:</span>
              <span className="font-medium text-light-600">
                {(hashResult.fileSize / 1024).toFixed(2)} KB
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-light-600">
              SHA-256 Hash:
            </label>
            <div className="relative">
              <div className="glass-dark p-3 rounded-lg font-mono text-xs text-light-600 break-all pr-12">
                {hashResult.hash}
              </div>
              <button
                onClick={() => copyToClipboard(hashResult.hash)}
                className={`absolute top-2 right-2 p-1.5 rounded-md transition-all duration-200 ${
                  copied
                    ? "bg-green-400/20 text-green-400"
                    : "bg-white/10 text-light-500 hover:bg-white/20 hover:text-accent-blue"
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
          </div>
        </div>
      )}

      {/* Enhanced QR Code Display */}
      {signature && (
        <div className="glass mt-4 p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded-full bg-accent-purple flex items-center justify-center">
              <svg
                className="w-3 h-3 text-white"
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
            <p className="font-medium text-accent-purple">
              Verification QR Code
            </p>
          </div>
          <QrCodeGenerator signature={signature} />
        </div>
      )}
    </div>
  );
}
