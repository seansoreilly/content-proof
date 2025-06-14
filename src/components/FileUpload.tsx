"use client";

import React, { useRef, useState } from "react";

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
];

function arrayBufferToHex(buffer: ArrayBuffer) {
  return Array.prototype.map
    .call(new Uint8Array(buffer), (x: number) =>
      x.toString(16).padStart(2, "0")
    )
    .join("");
}

async function sha256Hash(file: File): Promise<string> {
  const fileBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
  return arrayBufferToHex(hashBuffer);
}

export default function FileUpload() {
  const [dragActive, setDragActive] = useState(false);
  const [hashResult, setHashResult] = useState<HashResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const resetState = () => {
    setHashResult(null);
    setError(null);
    setPreviewUrl(null);
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
    } catch (err) {
      setError("Failed to generate hash. Please try again.");
      console.error(err);
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
          type="file"
          ref={inputRef}
          className="hidden"
          onChange={onFileChange}
        />
        <p className="text-gray-700 text-center">
          Drag &amp; drop a file here, or{" "}
          <span className="font-semibold">browse</span>
        </p>
      </div>

      {loading && (
        <p className="mt-4 text-blue-500 animate-pulse">Generating hash...</p>
      )}

      {error && <p className="mt-4 text-red-500 font-medium">Error: {error}</p>}

      {previewUrl && (
        <div className="mt-4">
          <p className="font-medium mb-2">Preview:</p>
          <img
            src={previewUrl}
            alt="File preview"
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
    </div>
  );
}
