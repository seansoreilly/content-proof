import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  KeyObject,
} from "crypto";

/**
 * Payload fields that are included in the signature. The concatenation order must be stable
 * so that signatures can be deterministically reproduced and verified.
 */
export interface SignaturePayload {
  /**
   * Hex‐encoded SHA-256 hash of the file being signed.
   */
  fileHash: string;
  /**
   * Gmail address of the user performing the signing operation.
   */
  gmail: string;
  /**
   * UNIX epoch timestamp (milliseconds) representing the time of signing.
   */
  timestamp: number;
}

/**
 * Result returned by {@link generateSignature}. Includes the public key so that
 * the consumer does not need access to server-side configuration to verify the
 * signature.
 */
export interface SignatureData {
  /** Base64URL-encoded detached Ed25519 signature */
  signature: string;
  /** Base64-encoded public key in SPKI DER format */
  publicKey: string;
  /** Millisecond timestamp copied from the payload */
  timestamp: number;
}

/**
 * Load the server's Ed25519 key pair from environment variables. The keys must
 * be provided as Base64-encoded DER buffers (PKCS#8 for the private key and
 * SPKI for the public key). When running locally without keys configured, a
 * new key pair will be generated on the fly so that development is not
 * blocked.
 */
function loadKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  const priv = process.env.ED25519_PRIVATE_KEY;
  const pub = process.env.ED25519_PUBLIC_KEY;

  if (priv && pub) {
    const privateKey = createPrivateKey({
      key: Buffer.from(priv, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const publicKey = createPublicKey({
      key: Buffer.from(pub, "base64"),
      format: "der",
      type: "spki",
    });
    return { privateKey, publicKey };
  }

  // Development fallback – generate an ephemeral key pair. DO **NOT** rely on
  // this in production; configure the environment variables instead.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey };
}

/**
 * Generate a deterministic Ed25519 signature for the given payload. The payload
 * values are concatenated with a colon separator and encoded as UTF-8 prior to
 * signing (e.g. `"<hash>:<gmail>:<timestamp>"`).
 */
export function generateSignature(payload: SignaturePayload): SignatureData {
  const { privateKey, publicKey } = loadKeyPair();
  const message = Buffer.from(
    `${payload.fileHash}:${payload.gmail}:${payload.timestamp}`,
    "utf8"
  );

  // For Ed25519 the algorithm parameter is ignored and should be `null`.
  const signature = sign(null, message, privateKey);

  return {
    signature: signature.toString("base64url"),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    timestamp: payload.timestamp,
  };
}

/**
 * Simple helper to expose the public key in Base64 so that it can be embedded
 * in client-side bundles without Node.js `crypto` imports.
 */
export function getPublicKeyBase64(): string {
  const { publicKey } = loadKeyPair();
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
} 