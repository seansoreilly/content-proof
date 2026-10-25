/**
 * Environment-agnostic byte/string encoding helpers. `atob`/`btoa` and
 * `TextEncoder`/`TextDecoder` exist in every supported browser and in Node 18+,
 * so the same code path runs on the server and in the verify page.
 */
export { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Decode standard Base64. Throws on invalid input. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode bytes as Base64URL without padding (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode Base64URL (padding optional). Throws on invalid input. */
export function fromBase64Url(base64url: string): Uint8Array {
  const padding = (4 - (base64url.length % 4)) % 4;
  const base64 = (base64url + "=".repeat(padding)).replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(base64);
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

export function stringToBase64Url(text: string): string {
  return toBase64Url(utf8ToBytes(text));
}

export function base64UrlToString(base64url: string): string {
  return bytesToUtf8(fromBase64Url(base64url));
}
