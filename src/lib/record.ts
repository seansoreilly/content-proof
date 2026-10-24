import { bytesToHex, fromBase64Url, hexToBytes, toBase64Url } from "@/lib/base64";

/**
 * The signature record is the complete, self-contained attestation that
 * travels inside the QR code / verification link. It is deliberately small so
 * the QR stays scannable, and every field is URL-safe so the record can live
 * in a URL fragment without further encoding.
 *
 * Wire format, version 2 (service attestation only):
 *   `2~<k>~<h>~<e>~<t>~<s>`
 *
 * Wire format, version 3 (account holder's own key plus service countersign):
 *   `3~<k>~<h>~<e>~<t>~<s>~<u>~<us>`
 *
 *  - k   service key id: first 16 chars of base64url(SHA-256(SPKI DER public key))
 *  - h   base64url SHA-256 of the file (43 chars)
 *  - e   signer email, percent-encoded (with `~` as %7E)
 *  - t   milliseconds since the Unix epoch
 *  - s   base64url Ed25519 signature by the service (86 chars)
 *  - u   base64url raw 32-byte Ed25519 public key held by the account holder (43 chars)
 *  - us  base64url Ed25519 signature by that key (86 chars)
 *
 * Messages that get signed (UTF-8):
 *  - the account holder's key signs        `<hash hex>:<email>:<t>`
 *  - the service signs, for version 2,     `<hash hex>:<email>:<t>`
 *  - the service signs, for version 3,     `<hash hex>:<email>:<t>:<u>:<us>`
 *    so the service attests to the user's key and signature as well.
 *
 * The version 2 layout predates this and must never change, or every existing
 * signature breaks.
 */
export const RECORD_VERSION = 2 as const;
export const RECORD_VERSION_USER_SIGNED = 3 as const;

export type RecordVersion = typeof RECORD_VERSION | typeof RECORD_VERSION_USER_SIGNED;

export interface SignatureRecord {
  v: RecordVersion;
  k: string;
  h: string;
  e: string;
  t: number;
  s: string;
  /** Present when v === 3. */
  u?: string;
  /** Present when v === 3. */
  us?: string;
}

const SEPARATOR = "~";
const KEY_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const B64_32_RE = /^[A-Za-z0-9_-]{43}$/;
const HASH_HEX_RE = /^[0-9a-f]{64}$/i;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

export function buildSignedMessage(hashHex: string, email: string, timestamp: number): string {
  return `${hashHex}:${email}:${timestamp}`;
}

/** What the service signs for a version 3 record. */
export function buildServiceMessageV3(
  hashHex: string,
  email: string,
  timestamp: number,
  userPublicKey: string,
  userSignature: string
): string {
  return `${buildSignedMessage(hashHex, email, timestamp)}:${userPublicKey}:${userSignature}`;
}

/** The message the service signed for a given record, whatever its version. */
export function serviceMessageFor(record: SignatureRecord, hashHex: string): string {
  if (record.v === RECORD_VERSION_USER_SIGNED && record.u && record.us) {
    return buildServiceMessageV3(hashHex, record.e, record.t, record.u, record.us);
  }
  return buildSignedMessage(hashHex, record.e, record.t);
}

export function hashHexToB64url(hashHex: string): string {
  if (!HASH_HEX_RE.test(hashHex)) throw new Error("Invalid SHA-256 hex digest");
  return toBase64Url(hexToBytes(hashHex.toLowerCase()));
}

export function hashB64urlToHex(hashB64url: string): string {
  if (!B64_32_RE.test(hashB64url)) throw new Error("Invalid SHA-256 base64url digest");
  const bytes = fromBase64Url(hashB64url);
  if (bytes.length !== 32) throw new Error("Invalid SHA-256 digest length");
  return bytesToHex(bytes);
}

/** True when the string is a well-formed base64url raw Ed25519 public key. */
export function isRawPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || !B64_32_RE.test(value)) return false;
  try {
    return fromBase64Url(value).length === 32;
  } catch {
    return false;
  }
}

export function isSignatureString(value: unknown): value is string {
  return typeof value === "string" && SIGNATURE_RE.test(value);
}

function encodeEmail(email: string): string {
  return encodeURIComponent(email).replace(/~/g, "%7E");
}

export function encodeRecord(record: SignatureRecord): string {
  const fields = [
    String(record.v),
    record.k,
    record.h,
    encodeEmail(record.e),
    String(record.t),
    record.s,
  ];
  if (record.v === RECORD_VERSION_USER_SIGNED) fields.push(record.u ?? "", record.us ?? "");
  return fields.join(SEPARATOR);
}

/**
 * Validate an untyped object (e.g. a parsed JSON body) as a signature record.
 */
export function parseRecordObject(input: unknown): SignatureRecord | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const vNum = typeof o.v === "number" ? o.v : typeof o.v === "string" ? Number(o.v) : NaN;
  const v: RecordVersion | null =
    vNum === RECORD_VERSION ? RECORD_VERSION : vNum === RECORD_VERSION_USER_SIGNED ? RECORD_VERSION_USER_SIGNED : null;
  const t = typeof o.t === "number" ? o.t : typeof o.t === "string" ? Number(o.t) : NaN;
  if (
    v === null ||
    typeof o.k !== "string" || !KEY_ID_RE.test(o.k) ||
    typeof o.h !== "string" || !B64_32_RE.test(o.h) ||
    typeof o.e !== "string" || !o.e.includes("@") || o.e.length > 320 ||
    !Number.isInteger(t) || t <= 0 ||
    !isSignatureString(o.s)
  ) {
    return null;
  }
  if (v === RECORD_VERSION_USER_SIGNED) {
    if (!isRawPublicKey(o.u) || !isSignatureString(o.us)) return null;
    return { v, k: o.k, h: o.h, e: o.e, t, s: o.s, u: o.u, us: o.us };
  }
  if (o.u !== undefined || o.us !== undefined) return null;
  return { v, k: o.k, h: o.h, e: o.e, t, s: o.s };
}

/** Decode the compact wire format. Returns null for anything malformed. */
export function decodeRecord(payload: string): SignatureRecord | null {
  if (typeof payload !== "string" || payload.length === 0) return null;
  const parts = payload.trim().split(SEPARATOR);
  if (parts.length !== 6 && parts.length !== 8) return null;
  const [v, k, h, encodedEmail, t, s, u, us] = parts;
  if ((parts.length === 8) !== (v === String(RECORD_VERSION_USER_SIGNED))) return null;
  let e: string;
  try {
    e = decodeURIComponent(encodedEmail);
  } catch {
    return null;
  }
  return parseRecordObject(parts.length === 8 ? { v, k, h, e, t, s, u, us } : { v, k, h, e, t, s });
}

const FRAGMENT_PARAM = "P";

/**
 * Build the link embedded in the QR code. The record rides in the URL fragment
 * so browsers never send it to the server: verification stays client-side and
 * the payload never lands in request logs.
 */
export function createVerificationUrl(encodedRecord: string, baseUrl?: string): string {
  const base =
    baseUrl ??
    process.env.NEXT_PUBLIC_VERIFY_BASE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/$/, "")}/verify#${FRAGMENT_PARAM}=${encodedRecord}`;
}

/**
 * Pull the raw (still percent-encoded) payload out of a verification URL or a
 * bare `#P=...` fragment. Deliberately avoids URLSearchParams, which would
 * decode %7E back into the separator character.
 */
export function extractPayloadFromUrl(urlOrFragment: string): string | null {
  const hashIndex = urlOrFragment.indexOf("#");
  const fragment = hashIndex >= 0 ? urlOrFragment.slice(hashIndex + 1) : urlOrFragment;
  for (const segment of fragment.split("&")) {
    if (segment.startsWith(`${FRAGMENT_PARAM}=`)) {
      const value = segment.slice(FRAGMENT_PARAM.length + 1);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
