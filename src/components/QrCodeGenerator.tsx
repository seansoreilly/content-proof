"use client";

import React, { useEffect, useState } from "react";
import {
  generateQrCodeDataUrl,
  createVerificationUrl,
  toBase64Url,
} from "@/lib/qr";
import { SignatureData } from "@/lib/crypto/ed25519";

interface Props {
  /**
   * The signature object obtained from the API. This will be JSON-encoded and
   * embedded into the verification link.
   */
  signature: SignatureData;
  /**
   * Optional pixel size of the generated QR code. Defaults to 256.
   */
  size?: number;
}

/**
 * Generates a QR code for the provided {@link SignatureData} and renders it as
 * an <img>. Includes a small download button to let users save the PNG.
 */
export const QrCodeGenerator: React.FC<Props> = ({ signature, size = 256 }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        setDataUrl(null);
        const encoded = toBase64Url(signature);
        const link = createVerificationUrl(encoded);
        setVerificationUrl(link);
        const url = await generateQrCodeDataUrl(link, {
          width: size,
          errorCorrectionLevel: "M",
        });
        setDataUrl(url);
      } catch (err) {
        console.error("QR code generation failed", err);
        setError("Failed to generate QR code. Please try again.");
      }
    })();
  }, [signature, size]);

  const copyToClipboard = async () => {
    if (!verificationUrl) return;
    try {
      await navigator.clipboard.writeText(verificationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleDownload = async () => {
    if (!dataUrl) return;
    setDownloading(true);
    // Add a small delay to show the downloading state
    setTimeout(() => setDownloading(false), 1000);
  };

  if (error) {
    return (
      <div className="glass p-4 border border-red-400/30 bg-red-400/10 animate-in fade-in duration-500">
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
          <p className="text-red-400 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div className="glass flex items-center justify-center p-6 animate-in fade-in duration-500">
        <div className="w-5 h-5 border-2 border-accent-purple/30 border-t-accent-purple rounded-full animate-spin mr-3"></div>
        <p className="text-light-600 font-medium">Generating QR code…</p>
      </div>
    );
  }

  return (
    <div className="glass flex flex-col items-center gap-6 p-6 animate-in fade-in duration-700">
      {/* QR Code with enhanced styling */}
      <div className="relative group">
        <div className="absolute -inset-2 bg-gradient-to-r from-accent-blue/20 to-accent-purple/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            alt="QR code containing the verification link"
            width={size}
            height={size}
            className="border border-white/30 rounded-xl shadow-2xl bg-white p-4 transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      </div>

      {/* Verification URL Section */}
      {verificationUrl && (
        <div className="w-full max-w-md space-y-3">
          <div className="glass p-4 rounded-lg relative bg-white/5">
            <p className="text-xs text-light-500 mb-2 font-medium">
              Verification Link:
            </p>
            <code className="text-xs text-light-600 break-all leading-relaxed block">
              {verificationUrl}
            </code>
            <button
              onClick={copyToClipboard}
              className={`absolute top-2 right-2 p-1.5 rounded-md transition-all duration-200 ${
                copied
                  ? "bg-green-400/20 text-green-400"
                  : "bg-white/10 text-light-500 hover:bg-white/20 hover:text-accent-blue"
              }`}
              title={copied ? "Copied!" : "Copy link"}
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

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <button
              onClick={copyToClipboard}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-300 ${
                copied
                  ? "bg-green-400/20 text-green-400 border border-green-400/30"
                  : "glass border border-white/20 text-light-600 hover:border-accent-blue/50 hover:text-accent-blue hover:bg-accent-blue/10"
              }`}
              disabled={copied}
            >
              {copied ? (
                <>
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
                  Copied!
                </>
              ) : (
                <>
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
                  Copy Link
                </>
              )}
            </button>

            <a
              href={dataUrl}
              download="signature_qrcode.png"
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 btn-primary px-4 py-2.5 text-sm font-medium transition-all duration-300 hover:scale-105 relative overflow-hidden group"
            >
              {downloading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Downloading...
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4 group-hover:scale-110 transition-transform duration-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Download PNG
                </>
              )}

              {/* Hover effect overlay */}
              <div className="absolute inset-0 bg-gradient-to-r from-accent-purple/20 to-accent-teal/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>
            </a>
          </div>
        </div>
      )}

      {/* Usage instructions */}
      <div className="text-center max-w-sm">
        <p className="text-xs text-light-400 leading-relaxed">
          Share this QR code with others to allow them to verify your
          file&apos;s authenticity. They can scan it or use the verification
          link directly.
        </p>
      </div>
    </div>
  );
};
