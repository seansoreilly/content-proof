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

  if (error) {
    return <p className="text-red-500 mt-2 font-medium">{error}</p>;
  }

  if (!dataUrl) {
    return (
      <div className="flex items-center justify-center mt-4 p-4">
        <div className="spinner mr-2"></div>
        <p className="text-light-600 font-medium">Generating QR code…</p>
      </div>
    );
  }

  return (
    <div className="glass flex flex-col items-center gap-4 mt-4 p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt="QR code containing the verification link"
        width={size}
        height={size}
        className="border border-white/20 rounded-lg shadow-lg"
      />
      {verificationUrl && (
        <div className="flex flex-col items-center gap-3 max-w-md break-all">
          <code className="text-xs glass-dark p-3 rounded text-light-600 w-full text-center">
            {verificationUrl}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(verificationUrl)}
            className="text-accent-blue hover:text-accent-purple transition-colors text-sm font-medium"
          >
            Copy verification link
          </button>
        </div>
      )}
      <a
        href={dataUrl}
        download="signature_qrcode.png"
        className="btn-secondary text-sm"
      >
        Download PNG
      </a>
    </div>
  );
};
