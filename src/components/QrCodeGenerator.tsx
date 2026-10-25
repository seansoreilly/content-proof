"use client";

import React, { useEffect, useState } from "react";
import { generateQrCodeDataUrl } from "@/lib/qr";
import { createVerificationUrl, encodeRecord, type SignatureRecord } from "@/lib/record";
import { composeSealPng, rimTextFor } from "@/lib/seal-image";
import { Seal } from "@/components/Seal";
import { Button, Panel, RecordSummary } from "@/components/ui";

interface Props {
  /** The signed record returned by /api/sign. */
  record: SignatureRecord;
  /** Rendered pixel size of the QR code. */
  size?: number;
}

type CopyTarget = "link" | "record";

const FALLBACK_PAPER = "#F7F7F4";
const FALLBACK_ACCENT = "#5B3FA3";

function readToken(name: "--paper" | "--accent", fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/**
 * Renders a record as a pressed seal around its verification QR code, with the
 * link and the raw record available to copy and the seal available as a PNG.
 */
export const QrCodeGenerator: React.FC<Props> = ({ record, size = 288 }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyTarget | null>(null);

  const encodedRecord = encodeRecord(record);
  const rimText = rimTextFor(record);

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

  const copy = async (target: CopyTarget): Promise<void> => {
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

  const downloadSeal = async (): Promise<void> => {
    if (!dataUrl) return;
    setDownloadError(null);
    try {
      const png = await composeSealPng({
        qrDataUrl: dataUrl,
        rimText,
        colors: {
          paper: readToken("--paper", FALLBACK_PAPER),
          accent: readToken("--accent", FALLBACK_ACCENT),
        },
      });
      const link = document.createElement("a");
      link.href = png;
      link.download = `contentproof-seal-${record.s.slice(0, 8)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Seal download failed", err);
      setDownloadError("Failed to create the seal image. Please try again.");
    }
  };

  if (error) {
    return (
      <Panel>
        <p className="font-semibold text-void" role="alert">
          {error}
        </p>
      </Panel>
    );
  }

  if (!dataUrl) {
    return (
      <Panel>
        <p className="text-mute" role="status">
          Generating QR code…
        </p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <Seal rimText={rimText} pressed={!!dataUrl}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt="QR code containing the verification link"
          className="block h-full w-full"
        />
      </Seal>

      <div className="w-full">
        <RecordSummary record={record} showHash={false} timeFormat="local" />
      </div>

      <div className="flex w-full flex-wrap gap-3">
        <Button onClick={() => void downloadSeal()}>Download seal</Button>
        {verificationUrl && (
          <Button variant="secondary" onClick={() => void copy("link")}>
            {copied === "link" ? "Copied" : "Copy link"}
          </Button>
        )}
      </div>

      {downloadError && (
        <p className="w-full font-semibold text-void" role="alert">
          {downloadError}
        </p>
      )}

      <details className="w-full">
        <summary className="eyebrow cursor-pointer select-none">Raw record</summary>
        <code className="mt-3 block break-all font-mono text-[13px]">{encodedRecord}</code>
        <Button variant="secondary" className="mt-3" onClick={() => void copy("record")}>
          {copied === "record" ? "Copied" : "Copy record"}
        </Button>
      </details>

      <p className="max-w-[60ch] text-sm text-mute">
        Anyone with this seal or link can confirm that this account submitted
        this exact file at this time. The record stays in the link; nothing is
        looked up on our servers except our published keys.
      </p>
      <p className="max-w-[60ch] text-sm text-mute">
        ContentProof does not keep a copy of your file. Send the original file
        along with the seal or link: the verifier checks it against this
        record in their own browser.
      </p>
    </div>
  );
};
