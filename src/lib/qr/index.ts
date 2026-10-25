// Cache the dynamic import so subsequent calls don't re-import the module
let qrCodePromise: Promise<typeof import("qrcode")> | null = null;

async function getQrCodeModule(): Promise<typeof import("qrcode")> {
  if (!qrCodePromise) {
    qrCodePromise = import("qrcode");
  }
  return qrCodePromise;
}

/**
 * Render `text` as a QR code PNG data URL. `qrcode` is imported lazily so pages
 * that never show a QR code don't pay for it.
 */
export async function generateQrCodeDataUrl(
  text: string,
  options: {
    width?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  } = {}
): Promise<string> {
  const { default: QRCode } = await getQrCodeModule();
  const { width = 288, errorCorrectionLevel = "M" } = options;

  return QRCode.toDataURL(text, {
    errorCorrectionLevel,
    width,
  });
}
