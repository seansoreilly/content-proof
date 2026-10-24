import { bytesToHex, fromBase64Url, hexToBytes, toBase64Url } from "@/lib/base64";

/**
 * The signature record is the complete, self-contained attestation that
 * travels inside the QR code / verification link. It is deliberately small so
 * the QR stays scannable, and every field is URL-safe so the record can live
 * in a URL fragment without further encoding.
 *
 * Wire format (version 2):  `2~<k>~<h>~<e>~<t>~<s>`
 *
 *  - k  key id: first 16 chars of base64url(SHA-256(SPKI DER public key))
 *  - h  base64url SHA-256 of the file (43 chars)
 *  - e  signer email, percent-encoded (with `~` as %7E)
 *  - t  milliseconds since the Unix epoch
 *  - s  base64url Ed25519 signature (86 chars)
 *
 * The signed message is `<hash hex>:<email>:<t>` (UTF-8). That layout predates
 * version 2 and must never change, or every existing signature breaks.
 */
export const RECORD_VERSION = 2 as const;

export interface SignatureRecord {
  v: typeof RECORD_VERSION;
  k: string;
  h: string;
  e: string;
  t: number;
  s: string;
}

const SEPARATOR = "~";
const KEY_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const HASH_B64_RE = /^[A-Za-z0-9_-]{43}$/;
const HASH_HEX_RE = /^[0-9a-f]{64}$/i;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

export function buildSignedMessage(hashHex: string, email: string, timestamp: number): string {
  return `${hashHex}:${email}:${timestamp}`;
}

export function hashHexToB64url(hashHex: string): string {
  if (!HASH_HEX_RE.test(hashHex)) throw new Error("Invalid SHA-256 hex digest");
  return toBase64Url(hexToBytes(hashHex.toLowerCase()));
}

export function hashB64urlToHex(hashB64url: string): string {
  if (!HASH_B64_RE.test(hashB64url)) throw new Error("Invalid SHA-256 base64url digest");
  const bytes = fromBase64Url(hashB64url);
  if (bytes.length !== 32) throw new Error("Invalid SHA-256 digest length");
  return bytesToHex(bytes);
}

function encodeEmail(email: string): string {
  return encodeURIComponent(email).replace(/~/g, "%7E");
}

export function encodeRecord(record: SignatureRecord): string {
  return [
    String(record.v),
    record.k,
    record.h,
    encodeEmail(record.e),
    String(record.t),
    record.s,
  ].join(SEPARATOR);
}

/**
 * Validate an untyped object (e.g. a parsed JSON body) as a signature record.
 */
export function parseRecordObject(input: unknown): SignatureRecord | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const v = o.v === RECORD_VERSION || o.v === String(RECORD_VERSION) ? RECORD_VERSION : null;
  const t = typeof o.t === "number" ? o.t : typeof o.t === "string" ? Number(o.t) : NaN;
  if (
    v === null ||
    typeof o.k !== "string" || !KEY_ID_RE.test(o.k) ||
    typeof o.h !== "string" || !HASH_B64_RE.test(o.h) ||
    typeof o.e !== "string" || !o.e.includes("@") || o.e.length > 320 ||
    !Number.isInteger(t) || t <= 0 ||
    typeof o.s !== "string" || !SIGNATURE_RE.test(o.s)
  ) {
    return null;
  }
  return { v, k: o.k, h: o.h, e: o.e, t, s: o.s };
}

/** Decode the compact wire format. Returns null for anything malformed. */
export function decodeRecord(payload: string): SignatureRecord | null {
  if (typeof payload !== "string" || payload.length === 0) return null;
  const parts = payload.trim().split(SEPARATOR);
  if (parts.length !== 6) return null;
  const [v, k, h, encodedEmail, t, s] = parts;
  let e: string;
  try {
    e = decodeURIComponent(encodedEmail);
  } catch {
    return null;
  }
  return parseRecordObject({ v, k, h, e, t, s });
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
