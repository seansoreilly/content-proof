export function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.prototype.map
    .call(new Uint8Array(buffer), (x: number) => x.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Calculate the SHA-256 hash of a {@link File} and return it as a hex string.
 * Uses the Web Crypto API which is available in all modern browsers.
 */
export async function sha256Hash(file: File): Promise<string> {
  const fileBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
  return arrayBufferToHex(hashBuffer);
} 