import { generateKeyPairSync } from "crypto";

export interface PublicKeysJson {
  /** Base64‐encoded SPKI DER current public key */
  current: string;
  /** Array of Base64‐encoded SPKI DER historical public keys */
  history: string[];
}

/**
 * Return the Base64‐encoded current public key. Throws if not configured.
 */
export function getCurrentPublicKey(): string {
  const pub = process.env.ED25519_PUBLIC_KEY;
  if (!pub || pub.trim().length === 0) {
    throw new Error("ED25519_PUBLIC_KEY environment variable is not set");
  }
  return pub.trim();
}

/**
 * Return a list of historical public keys that are still considered valid for
 * signature verification. Keys must be provided in the environment variable
 * `ED25519_PUBLIC_KEYS_PREVIOUS` as a comma-separated list of Base64 strings.
 */
export function getHistoricalPublicKeys(): string[] {
  const raw = process.env.ED25519_PUBLIC_KEYS_PREVIOUS ?? "";
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * Helper that returns the JSON payload served at `/.well-known/public-keys.json`.
 */
export function buildPublicKeysJson(): PublicKeysJson {
  return {
    current: getCurrentPublicKey(),
    history: getHistoricalPublicKeys(),
  };
}

/**
 * Combined helper used by verification routines to iterate over all valid
 * public keys (current first, followed by historical ones).
 */
export function getAllValidPublicKeys(): string[] {
  const { current, history } = buildPublicKeysJson();
  return [current, ...history];
}

/**
 * Generate a brand new Ed25519 key pair and return them as Base64‐encoded DER
 * strings. **This function does NOT persist the keys automatically.** Callers
 * are responsible for securely updating the environment variables (or secret
 * storage) and redeploying the application.
 */
export function generateNewEd25519KeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
} 