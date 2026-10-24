import { sha256 } from "@noble/hashes/sha2.js";
import { base64ToBytes, toBase64Url } from "@/lib/base64";

/**
 * Browser-safe view of the service's published verification keys. This module
 * must not import `node:crypto`; it is used by the verify page.
 */
export interface PublicKeyEntry {
  keyId: string;
  algorithm: "Ed25519";
  /** Base64 (standard) SPKI DER encoding of the public key. */
  publicKey: string;
}

export interface PublicKeysJson {
  current: string;
  keys: Record<string, PublicKeyEntry>;
}

export const KEY_ID_LENGTH = 16;

/** Derive the key id used in records from the SPKI DER public key. */
export function keyIdFromSpkiBase64(spkiBase64: string): string {
  return toBase64Url(sha256(base64ToBytes(spkiBase64))).slice(0, KEY_ID_LENGTH);
}

export function findPublicKey(keys: PublicKeysJson, keyId: string): PublicKeyEntry | undefined {
  if (!keyId) return undefined;
  return Object.prototype.hasOwnProperty.call(keys.keys, keyId) ? keys.keys[keyId] : undefined;
}

export function isKnownPublicKey(keys: PublicKeysJson, spkiBase64: string): boolean {
  return Object.values(keys.keys).some((entry) => entry.publicKey === spkiBase64);
}

/** Runtime check for a fetched well-known document. */
export function parsePublicKeysJson(input: unknown): PublicKeysJson | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (typeof o.current !== "string" || !o.keys || typeof o.keys !== "object") return null;
  const keys: Record<string, PublicKeyEntry> = {};
  for (const [id, raw] of Object.entries(o.keys as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") return null;
    const entry = raw as Record<string, unknown>;
    if (entry.algorithm !== "Ed25519" || typeof entry.publicKey !== "string") return null;
    keys[id] = { keyId: id, algorithm: "Ed25519", publicKey: entry.publicKey };
  }
  return { current: o.current, keys };
}
