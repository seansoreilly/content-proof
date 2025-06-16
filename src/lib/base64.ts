export function fromBase64Url(base64url: string): Uint8Array {
  // Pad string to length divisible by 4
  const padding = 4 - (base64url.length % 4 || 4);
  const base64 = (base64url + "=".repeat(padding))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (typeof window === "undefined") {
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }
  const binary = window.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Convenience helper that decodes a Base64URL string directly to UTF-8.
 * Uses {@link fromBase64Url} internally and handles both Node and browser
 * environments.
 */
export function base64UrlToString(base64url: string): string {
  const bytes = fromBase64Url(base64url);
  return typeof window === "undefined"
    ? Buffer.from(bytes).toString("utf8")
    : new TextDecoder("utf-8").decode(bytes);
}
