import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { keyIdFromSpkiBase64, type PublicKeysJson } from "@/lib/keyset";

/**
 * Server-side key management. Keys are supplied as Base64 DER via environment
 * variables (PKCS#8 for the private key, SPKI for the public key).
 *
 * In production a missing key pair is a hard error raised when signing or
 * publishing keys is attempted (not at import time, so `next build` works
 * without secrets). In development a single throwaway pair is generated once
 * per process so that sign → verify works end to end.
 */
export interface SigningKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyBase64: string;
  keyId: string;
}

let developmentPair: SigningKeyPair | null = null;

function toSigningKeyPair(privateKey: KeyObject, publicKey: KeyObject): SigningKeyPair {
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { privateKey, publicKey, publicKeyBase64, keyId: keyIdFromSpkiBase64(publicKeyBase64) };
}

export function getSigningKeyPair(): SigningKeyPair {
  const priv = process.env.ED25519_PRIVATE_KEY?.trim();
  const pub = process.env.ED25519_PUBLIC_KEY?.trim();

  if (priv && pub) {
    const privateKey = createPrivateKey({ key: Buffer.from(priv, "base64"), format: "der", type: "pkcs8" });
    const publicKey = createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
    return toSigningKeyPair(privateKey, publicKey);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ED25519_PRIVATE_KEY and ED25519_PUBLIC_KEY must be configured in production"
    );
  }

  if (!developmentPair) {
    console.warn(
      "[keys] ED25519 keys not configured; using a throwaway development key pair. " +
        "Signatures from this process cannot be verified after restart."
    );
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    developmentPair = toSigningKeyPair(privateKey, publicKey);
  }
  return developmentPair;
}

/**
 * Historical public keys still accepted for verification after a rotation.
 * `ED25519_PUBLIC_KEYS_PREVIOUS` is a comma-separated list of Base64 SPKI DER.
 */
export function getHistoricalPublicKeys(): string[] {
  return (process.env.ED25519_PUBLIC_KEYS_PREVIOUS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/** The document served at `/.well-known/public-keys.json`. */
export function buildPublicKeysJson(): PublicKeysJson {
  const current = getSigningKeyPair();
  const keys: PublicKeysJson["keys"] = {
    [current.keyId]: { keyId: current.keyId, algorithm: "Ed25519", publicKey: current.publicKeyBase64 },
  };
  for (const publicKey of getHistoricalPublicKeys()) {
    const keyId = keyIdFromSpkiBase64(publicKey);
    keys[keyId] = { keyId, algorithm: "Ed25519", publicKey };
  }
  return { current: current.keyId, keys };
}

/**
 * Generate a brand new Ed25519 key pair as Base64 DER strings. Nothing is
 * persisted; the caller updates the environment and redeploys.
 */
export function generateNewEd25519KeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}
