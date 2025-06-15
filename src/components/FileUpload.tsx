"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { QrCodeGenerator } from "@/components/QrCodeGenerator";
import { sha256Hash } from "@/lib/hash";

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

  const inputRef = useRef<HTMLInputElement | null>(null);

  const resetState = () => {
    setHashResult(null);
    setError(null);
    setPreviewUrl(null);
    setSignature(null);
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
      const hash = await sha256Hash(file);
      setHashResult({ fileName: file.name, fileSize: file.size, hash });

      // Call the sign API to generate signature data
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileHash: hash }),
      });
      if (!res.ok) {
        throw new Error(`Signature API error: ${res.status}`);
      }
      const data =
        (await res.json()) as import("@/lib/crypto/ed25519").SignatureData;
      setSignature(data);
    } catch (err) {
      console.error(err);
      setError("Failed to generate signature.");
    } finally {
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

  return (
    <div className="w-full max-w-lg mx-auto p-4">
      <div
        className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-colors duration-200 ${
          dragActive ? "border-blue-500 bg-blue-50" : "border-gray-300"
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
        <p className="text-gray-700 text-center">
          Drag &amp; drop a file here, or{" "}
          <span className="font-semibold text-blue-600 hover:underline cursor-pointer">
            browse
          </span>
        </p>
      </div>

      {loading && (
        <p className="mt-4 text-blue-500 animate-pulse">Generating hash...</p>
      )}

      {error && <p className="mt-4 text-red-500 font-medium">Error: {error}</p>}

      {previewUrl && (
        <div className="mt-4">
          <p className="font-medium mb-2">Preview:</p>
          <Image
            src={previewUrl}
            alt="File preview"
            width={256}
            height={256}
            className="max-h-64 object-contain border rounded"
          />
        </div>
      )}

      {hashResult && (
        <div className="mt-4 break-all">
          <p className="font-medium">File: {hashResult.fileName}</p>
          <p className="text-sm text-gray-600 mb-2">
            Size: {(hashResult.fileSize / 1024).toFixed(2)} KB
          </p>
          <p className="font-mono text-xs bg-gray-100 p-2 rounded">
            {hashResult.hash}
          </p>
          <button
            className="mt-2 text-blue-600 hover:underline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(hashResult.hash);
              } catch (err) {
                console.error("Clipboard write failed", err);
              }
            }}
          >
            Copy Hash
          </button>
        </div>
      )}

      {signature && (
        <div className="mt-6">
          <p className="font-medium text-center">
            QR Code with embedded verification link:
          </p>
          <QrCodeGenerator signature={signature} />
        </div>
      )}
    </div>
  );
}
