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