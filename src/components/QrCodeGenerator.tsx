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
      <p className="text-gray-600 mt-2 animate-pulse">Generating QR code…</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 mt-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt="QR code containing the verification link"
        width={size}
        height={size}
        className="border rounded"
      />
      {verificationUrl && (
        <div className="flex flex-col items-center gap-1 max-w-md break-all">
          <code className="text-xs bg-gray-100 p-2 rounded">
            {verificationUrl}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(verificationUrl)}
            className="text-blue-600 hover:underline text-sm"
          >
            Copy verification link
          </button>
        </div>
      )}
      <a
        href={dataUrl}
        download="signature_qrcode.png"
        className="text-blue-600 hover:underline text-sm"
      >
        Download PNG
      </a>
    </div>
  );
};
