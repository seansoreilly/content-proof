import * as nacl from "tweetnacl";
import { fromBase64Url } from "@/lib/base64";

/**
 * Extract the 32-byte raw Ed25519 public key from an SPKI DER (Base64) buffer.
 * The ASN.1 header for Ed25519 public keys is 12 bytes long:
 * `302a300506032b6570032100`.
 */
function spkiBase64ToRawKey(base64: string): Uint8Array {
  const der = typeof window === "undefined"
    ? Uint8Array.from(Buffer.from(base64, "base64"))
    : Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  // The raw key is the last 32 bytes of the DER structure.
  if (der.length < 32) {
    throw new Error("Invalid SPKI public key");
  }
  return der.slice(-32);
}

/**
 * Verify an Ed25519 signature. Returns `true` if the signature is valid.
 *
 * @param message  The signed message as UTF-8 string or Uint8Array.
 * @param signatureBase64Url  Base64URL-encoded detached signature (64 bytes).
 * @param publicKeyBase64  Base64-encoded SPKI DER public key.
 */
export function verifyEd25519Signature(
  message: string | Uint8Array,
  signatureBase64Url: string,
  publicKeyBase64: string
): boolean {
  const msg =
    typeof message === "string" ? new TextEncoder().encode(message) : message;
  const signature = fromBase64Url(signatureBase64Url);
  if (signature.length !== 64) return false;
  const publicKey = spkiBase64ToRawKey(publicKeyBase64);
  return nacl.sign.detached.verify(msg, signature, publicKey);
} 