import { sign } from "node:crypto";
import { getSigningKeyPair } from "@/lib/keys";
import { verifyEd25519Raw } from "@/lib/crypto/verify";
import {
  RECORD_VERSION,
  RECORD_VERSION_USER_SIGNED,
  buildServiceMessageV3,
  buildSignedMessage,
  hashHexToB64url,
  isRawPublicKey,
  isSignatureString,
  type SignatureRecord,
} from "@/lib/record";

/** Signature the account holder made in their browser with their own key. */
export interface UserSignature {
  /** base64url raw 32-byte Ed25519 public key. */
  publicKey: string;
  /** base64url 64-byte signature over `<hash hex>:<email>:<timestamp>`. */
  signature: string;
}

export class InvalidUserSignatureError extends Error {
  constructor(message = "User signature does not verify") {
    super(message);
    this.name = "InvalidUserSignatureError";
  }
}

/**
 * Produce the service's attestation for a file hash submitted by `email`.
 *
 * Without `user`: a version 2 record, meaning "ContentProof attests that
 * account <email> submitted SHA-256 <hash> at <timestamp>".
 *
 * With `user`: the account holder's own key has already signed the same
 * statement in their browser; the service checks that signature and then
 * countersigns a statement that includes the user's key and signature,
 * producing a version 3 record. The service never sees the private key.
 */
export function signFileHash(
  hashHex: string,
  email: string,
  timestamp: number = Date.now(),
  user?: UserSignature
): SignatureRecord {
  const normalisedHash = hashHex.toLowerCase();
  const h = hashHexToB64url(normalisedHash); // validates the digest
  const { privateKey, keyId } = getSigningKeyPair();

  if (!user) {
    const message = Buffer.from(buildSignedMessage(normalisedHash, email, timestamp), "utf8");
    // For Ed25519 the digest algorithm must be null.
    const signature = sign(null, message, privateKey);
    return { v: RECORD_VERSION, k: keyId, h, e: email, t: timestamp, s: signature.toString("base64url") };
  }

  if (!isRawPublicKey(user.publicKey) || !isSignatureString(user.signature)) {
    throw new InvalidUserSignatureError("Malformed user key or signature");
  }
  const userMessage = buildSignedMessage(normalisedHash, email, timestamp);
  if (!verifyEd25519Raw(userMessage, user.signature, user.publicKey)) {
    throw new InvalidUserSignatureError();
  }
  const serviceMessage = Buffer.from(
    buildServiceMessageV3(normalisedHash, email, timestamp, user.publicKey, user.signature),
    "utf8"
  );
  const signature = sign(null, serviceMessage, privateKey);
  return {
    v: RECORD_VERSION_USER_SIGNED,
    k: keyId,
    h,
    e: email,
    t: timestamp,
    s: signature.toString("base64url"),
    u: user.publicKey,
    us: user.signature,
  };
}
