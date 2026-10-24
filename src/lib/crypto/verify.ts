import * as nacl from "tweetnacl";
import { base64ToBytes, fromBase64Url, utf8ToBytes } from "@/lib/base64";
import {
  findPublicKey,
  isKnownPublicKey,
  keyIdFromSpkiBase64,
  type PublicKeysJson,
} from "@/lib/keyset";
import {
  RECORD_VERSION_USER_SIGNED,
  buildSignedMessage,
  hashB64urlToHex,
  serviceMessageFor,
  type SignatureRecord,
} from "@/lib/record";

/**
 * Environment-agnostic verification. Runs identically in the browser (verify
 * page) and on the server (/api/verify). The set of acceptable service keys is
 * always passed in explicitly and must come from the service's published
 * well-known document, never from the record being verified.
 */
export type VerificationFailure =
  | "unknown-key"
  | "hash-mismatch"
  | "bad-signature"
  | "bad-user-signature"
  | "malformed";

export interface VerificationResult {
  ok: boolean;
  keyId?: string;
  /** True when the record also carries a valid signature by the account holder's own key. */
  userSigned?: boolean;
  /** The account holder's raw public key (base64url) when userSigned. */
  userKey?: string;
  reason?: VerificationFailure;
}

/** Extract the raw 32-byte Ed25519 key: the trailing 32 bytes of the SPKI DER. */
function spkiBase64ToRawKey(spkiBase64: string): Uint8Array {
  const der = base64ToBytes(spkiBase64);
  if (der.length < 32) throw new Error("Invalid SPKI public key");
  return der.slice(-32);
}

function verifyDetached(message: string | Uint8Array, signatureBase64Url: string, rawKey: Uint8Array): boolean {
  try {
    const msg = typeof message === "string" ? utf8ToBytes(message) : message;
    const signature = fromBase64Url(signatureBase64Url);
    if (signature.length !== 64 || rawKey.length !== 32) return false;
    return nacl.sign.detached.verify(msg, signature, rawKey);
  } catch {
    return false;
  }
}

/** Verify against a service key given as base64 SPKI DER. */
export function verifyEd25519(
  message: string | Uint8Array,
  signatureBase64Url: string,
  publicKeySpkiBase64: string
): boolean {
  try {
    return verifyDetached(message, signatureBase64Url, spkiBase64ToRawKey(publicKeySpkiBase64));
  } catch {
    return false;
  }
}

/** Verify against a raw 32-byte Ed25519 public key given as base64url (account holder keys). */
export function verifyEd25519Raw(
  message: string | Uint8Array,
  signatureBase64Url: string,
  rawPublicKeyBase64Url: string
): boolean {
  try {
    return verifyDetached(message, signatureBase64Url, fromBase64Url(rawPublicKeyBase64Url));
  } catch {
    return false;
  }
}

/**
 * Verify a record against the file's SHA-256 (hex) and the published key set.
 * Order matters for the error reported: an unpublished key is the most
 * important thing to tell the user, then a changed file, then a bad service
 * signature, then a bad account-holder signature.
 */
export function verifyRecord(
  record: SignatureRecord,
  fileHashHex: string,
  keys: PublicKeysJson
): VerificationResult {
  const entry = findPublicKey(keys, record.k);
  if (!entry || keyIdFromSpkiBase64(entry.publicKey) !== record.k) {
    return { ok: false, reason: "unknown-key" };
  }

  let recordHashHex: string;
  try {
    recordHashHex = hashB64urlToHex(record.h);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (recordHashHex !== fileHashHex.toLowerCase()) {
    return { ok: false, reason: "hash-mismatch" };
  }

  if (!verifyEd25519(serviceMessageFor(record, recordHashHex), record.s, entry.publicKey)) {
    return { ok: false, reason: "bad-signature" };
  }

  if (record.v === RECORD_VERSION_USER_SIGNED) {
    if (!record.u || !record.us) return { ok: false, reason: "malformed" };
    const userMessage = buildSignedMessage(recordHashHex, record.e, record.t);
    if (!verifyEd25519Raw(userMessage, record.us, record.u)) {
      return { ok: false, reason: "bad-user-signature" };
    }
    return { ok: true, keyId: record.k, userSigned: true, userKey: record.u };
  }

  return { ok: true, keyId: record.k, userSigned: false };
}

/** Shape of the pre-version-2 payload that older QR codes still carry. */
export interface LegacyPayload {
  signature: string;
  publicKey: string;
  timestamp: number;
}

/**
 * Legacy payloads embed a public key but no email or hash. They are accepted
 * only when the embedded key is one the service has published; the verifier
 * supplies the email and the file.
 */
export function verifyLegacyPayload(
  payload: LegacyPayload,
  email: string,
  fileHashHex: string,
  keys: PublicKeysJson
): VerificationResult {
  if (!isKnownPublicKey(keys, payload.publicKey)) {
    return { ok: false, reason: "unknown-key" };
  }
  const message = buildSignedMessage(fileHashHex.toLowerCase(), email, payload.timestamp);
  return verifyEd25519(message, payload.signature, payload.publicKey)
    ? { ok: true, keyId: keyIdFromSpkiBase64(payload.publicKey), userSigned: false }
    : { ok: false, reason: "bad-signature" };
}
