import { sign } from "node:crypto";
import { getSigningKeyPair } from "@/lib/keys";
import {
  RECORD_VERSION,
  buildSignedMessage,
  hashHexToB64url,
  type SignatureRecord,
} from "@/lib/record";

/**
 * Produce the service's attestation for a file hash submitted by `email`.
 *
 * What this proves: ContentProof's key signed the statement "account <email>
 * submitted SHA-256 <hash> at <timestamp>". It is a notarisation by the
 * service, not a signature made with a key the user controls.
 */
export function signFileHash(
  hashHex: string,
  email: string,
  timestamp: number = Date.now()
): SignatureRecord {
  const normalisedHash = hashHex.toLowerCase();
  const h = hashHexToB64url(normalisedHash); // validates the digest
  const { privateKey, keyId } = getSigningKeyPair();
  const message = Buffer.from(buildSignedMessage(normalisedHash, email, timestamp), "utf8");
  // For Ed25519 the digest algorithm must be null.
  const signature = sign(null, message, privateKey);
  return {
    v: RECORD_VERSION,
    k: keyId,
    h,
    e: email,
    t: timestamp,
    s: signature.toString("base64url"),
  };
}
