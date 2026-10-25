"use client";

import React, { useEffect, useState } from "react";
import { generateQrCodeDataUrl } from "@/lib/qr";
import { createVerificationUrl, encodeRecord, type SignatureRecord } from "@/lib/record";

interface Props {
  /** The signed record returned by /api/sign. */
  record: SignatureRecord;
  /** Rendered pixel size of the QR code. */
  size?: number;
}

type CopyTarget = "link" | "record";

/**
 * Renders the verification link for a record as a QR code, with the link and
 * the raw record available to copy for people who would rather paste.
 */
export const QrCodeGenerator: React.FC<Props> = ({ record, size = 288 }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyTarget | null>(null);

  const encodedRecord = encodeRecord(record);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        setDataUrl(null);
        const link = createVerificationUrl(encodedRecord);
        const url = await generateQrCodeDataUrl(link, { width: size, errorCorrectionLevel: "M" });
        if (cancelled) return;
        setVerificationUrl(link);
        setDataUrl(url);
      } catch (err) {
        console.error("QR code generation failed", err);
        if (!cancelled) setError("Failed to generate QR code. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [encodedRecord, size]);

  const copy = async (target: CopyTarget) => {
    const text = target === "link" ? verificationUrl : encodedRecord;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (error) {
    return (
      <div className="glass p-4 border border-red-400/30 bg-red-400/10">
        <p className="text-red-400 font-medium">{error}</p>
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div className="glass flex items-center justify-center p-6">
        <div className="w-5 h-5 border-2 border-accent-purple/30 border-t-accent-purple rounded-full animate-spin mr-3"></div>
        <p className="text-light-600 font-medium">Generating QR code…</p>
      </div>
    );
  }

  return (
    <div className="glass flex flex-col items-center gap-6 p-6">
      <div className="w-full text-sm text-light-600 space-y-1">
        <p>
          <span className="text-light-500">Attested for:</span>{" "}
          <span className="font-medium break-all">{record.e}</span>
        </p>
        <p>
          <span className="text-light-500">At:</span>{" "}
          <span className="font-medium">{new Date(record.t).toLocaleString()}</span>
        </p>
        <p>
          <span className="text-light-500">Key:</span>{" "}
          <code className="text-xs">{record.k}</code>
        </p>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt="QR code containing the verification link"
        width={size}
        height={size}
        className="border border-white/30 rounded-xl shadow-2xl bg-white p-4"
      />

      <a
        href={dataUrl}
        download="contentproof-qrcode.png"
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium btn-primary"
      >
        Download QR code
      </a>

      {verificationUrl && (
        <div className="w-full max-w-md space-y-3">
          <div className="glass p-4 rounded-lg bg-white/5 space-y-2">
            <p className="text-xs text-light-500 font-medium">Verification link</p>
            <code className="text-xs text-light-600 break-all leading-relaxed block">
              {verificationUrl}
            </code>
            <button
              onClick={() => copy("link")}
              className={`text-xs px-3 py-1.5 rounded-md ${
                copied === "link" ? "bg-green-400/20 text-green-400" : "bg-white/10 text-light-500 hover:bg-white/20"
              }`}
            >
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
          </div>

          <details className="glass p-4 rounded-lg bg-white/5">
            <summary className="cursor-pointer text-xs text-light-500 font-medium select-none">
              Raw record (for pasting into the verifier)
            </summary>
            <code className="text-xs text-light-600 break-all leading-relaxed block mt-2">
              {encodedRecord}
            </code>
            <button
              onClick={() => copy("record")}
              className={`mt-2 text-xs px-3 py-1.5 rounded-md ${
                copied === "record" ? "bg-green-400/20 text-green-400" : "bg-white/10 text-light-500 hover:bg-white/20"
              }`}
            >
              {copied === "record" ? "Copied" : "Copy record"}
            </button>
          </details>
        </div>
      )}

      <p className="text-xs text-light-400 leading-relaxed text-center max-w-sm">
        Anyone with this QR code or link can confirm that this account submitted
        this exact file at this time. The record stays in the link; nothing is
        looked up on our servers except our published keys.
      </p>
    </div>
  );
};
