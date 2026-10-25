"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { QrCodeGenerator } from "@/components/QrCodeGenerator";
import { MAX_FILE_SIZE_BYTES, sha256Hash } from "@/lib/hash";
import { buildSignedMessage, parseRecordObject, type SignatureRecord } from "@/lib/record";
import { getOrCreateUserKey, type UserSigningKey } from "@/lib/user-keys";
import { trackSignFile } from "@/lib/analytics";
import { Eyebrow } from "@/components/ui";
import { DropSeal } from "@/components/DropSeal";

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

export default function FileUpload(): React.JSX.Element {
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
    // Moving onto a child of the zone fires dragleave too; only a real exit counts.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
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
  const stageLabel = stage === "hashing" ? "Hashing" : "Signing";

  return (
    <div className="w-full space-y-6">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a file to sign"
        aria-disabled={busy}
        className={`group flex flex-col items-center gap-5 px-5 py-7 text-center shadow-pressed transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:flex-row sm:gap-8 sm:px-8 sm:py-9 sm:text-left ${
          dragActive ? "bg-tint" : "bg-paper"
        } ${busy ? "cursor-progress" : "cursor-pointer"}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={busy ? undefined : onButtonClick}
        onKeyDown={(e) => {
          if (busy) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onButtonClick();
          }
        }}
      >
        <input id="fileInput" type="file" ref={inputRef} className="hidden" onChange={onFileChange} />

        <DropSeal
          state={busy ? "busy" : dragActive ? "over" : "idle"}
          rimText={`${busy ? stageLabel : "Unsealed · awaiting a file"} · `.repeat(busy ? 4 : 2)}
        />

        <div className="min-w-0 space-y-2">
          <p className="font-display text-[22px] font-bold uppercase leading-none tracking-[-0.01em] sm:text-[26px]">
            {busy ? `${stageLabel}…` : dragActive ? "Release to sign" : "Drop a file to sign it"}
          </p>
          {busy ? (
            <p className="text-mute" role="status">
              {stage === "hashing"
                ? "Reading the file in this browser."
                : "Sending the fingerprint for countersignature."}
            </p>
          ) : (
            <p className="text-mute">
              or{" "}
              <span className="text-accent underline decoration-1 underline-offset-[3px] group-hover:decoration-2">
                choose one from your device
              </span>
            </p>
          )}
          <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-mute">
            Any type · up to {MAX_FILE_SIZE_LABEL}
          </p>
        </div>
      </div>

      {error && (
        <p className="font-semibold text-void" role="alert">
          {error}
        </p>
      )}

      {previewUrl && (
        <details>
          <summary className="eyebrow cursor-pointer select-none">Preview</summary>
          <div className="mt-3 p-3 shadow-pressed">
            <Image
              src={previewUrl}
              alt="File preview"
              width={256}
              height={256}
              unoptimized
              className="max-h-64 w-full object-contain"
            />
          </div>
        </details>
      )}

      {hashResult && (
        <dl className="grid gap-4">
          <div>
            <dt className="eyebrow">File</dt>
            <dd className="mt-1 break-all">{hashResult.fileName}</dd>
          </div>
          <div>
            <dt className="eyebrow">Size</dt>
            <dd className="mt-1">{formatSize(hashResult.fileSize)}</dd>
          </div>
          <div>
            <dt className="eyebrow">SHA-256</dt>
            <dd className="mt-1 break-all font-mono text-[13px]">{hashResult.hash}</dd>
          </div>
        </dl>
      )}

      {record && <QrCodeGenerator record={record} />}

      <div className="space-y-2 pt-2" data-testid="user-key">
        {userKey === "unsupported" ? (
          <p className="text-sm text-mute">
            This browser cannot hold a signing key, so records are service attestations only. A current
            Chrome, Firefox or Safari adds your own signature.
          </p>
        ) : userKey ? (
          <>
            <Eyebrow>Your signing key (this browser)</Eyebrow>
            <code className="block break-all font-mono text-[13px]">{userKey.publicKey}</code>
            <p className="text-sm text-mute">
              Records you create here carry a signature made with this key. It never leaves this device.
              Publish this key where people can find you so they can tie your records to you, not just to
              your account.
            </p>
          </>
        ) : (
          <p className="text-sm text-mute">Preparing your signing key…</p>
        )}
      </div>
    </div>
  );
}
