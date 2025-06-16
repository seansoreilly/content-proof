export type EncodingInput = object | string;

/**
 * Encode an object (or string) as Base64URL.
 * - JSON-stringifies objects automatically
 * - Uses native `Buffer` in Node.js and `btoa` in the browser
 */
export function toBase64Url(input: EncodingInput): string {
  const str = typeof input === "string" ? input : JSON.stringify(input);

  // Standard Base64 encoding depending on the environment
  const base64 =
    typeof window === "undefined"
      ? Buffer.from(str, "utf8").toString("base64")
      : // `btoa` expects binary string; encode UTF-8 first
        window.btoa(unescape(encodeURIComponent(str)));

  // Make the string URL-safe (Base64URL) by replacing reserved chars and
  // trimming padding as per RFC 4648 §5.
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Create the self-contained verification URL that will later be embedded into
 * the QR code. The base URL can be configured via `NEXT_PUBLIC_VERIFY_BASE_URL`
 * (e.g. https://example.com) and falls back to the current origin on the
 * client or an empty string during server-side rendering.
 */
export function createVerificationUrl(encodedData: string): string {
  const base =
    // Prefer explicit env override so that links for previews/production are correct
    process.env.NEXT_PUBLIC_VERIFY_BASE_URL ||
    // On the browser we can reliably use `location.origin`
    (typeof window !== "undefined" ? window.location.origin : "");

  return `${base}/verify?data=${encodedData}`;
}

// Cache the dynamic import so subsequent calls don't re-import the module
let qrCodePromise: Promise<typeof import("qrcode")> | null = null;

async function getQrCodeModule() {
  if (!qrCodePromise) {
    qrCodePromise = import("qrcode");
  }
  return qrCodePromise;
}

/**
 * Dynamically import `qrcode` to avoid increasing the serverless bundle size
 * for pages that don't need QR capabilities. Returns a PNG data URL that can
 * be used as the `src` attribute of an <img> tag or as a download link href.
 */
export async function generateQrCodeDataUrl(
  text: string,
  options: {
    width?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  } = {}
): Promise<string> {
  const { default: QRCode } = await getQrCodeModule();
  const { width = 256, errorCorrectionLevel = "M" } = options;

  return QRCode.toDataURL(text, {
    errorCorrectionLevel,
    width,
  });
} 
