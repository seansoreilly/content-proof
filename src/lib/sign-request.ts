import type { UserSignature } from "@/lib/crypto/ed25519";
import { isHashHex, isRawPublicKey, isSignatureString } from "@/lib/record";

/** How far the client's proposed timestamp may differ from the server clock. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** A validated body for `POST /api/sign`. */
export type SignRequest =
  | { kind: "service"; fileHash: string }
  | { kind: "user"; fileHash: string; timestamp: number; user: UserSignature };

export type ParseSignRequestResult = { ok: true; request: SignRequest } | { ok: false; error: string };

/**
 * Validate the JSON body of `POST /api/sign`.
 *
 * Kept pure (the clock and the service-key lookup are passed in) so every
 * acceptance rule can be unit tested without a server, keys or storage. The
 * error strings are part of the API: the browser shows them, so they must stay
 * stable.
 *
 * Any one of `userPublicKey`, `userSignature` or `timestamp` switches the
 * request to version 3 mode, which then requires all three. A lone timestamp
 * is never accepted for a version 2 record, because the server picks that
 * timestamp itself.
 */
export function parseSignRequest(
  body: unknown,
  now: number,
  isServiceKey: (userPublicKey: string) => boolean
): ParseSignRequestResult {
  const input = (typeof body === "object" && body !== null ? body : {}) as {
    fileHash?: unknown;
    timestamp?: unknown;
    userPublicKey?: unknown;
    userSignature?: unknown;
  };
  if (!isHashHex(input.fileHash)) {
    return { ok: false, error: "Invalid fileHash" };
  }
  const fileHash = input.fileHash;

  if (input.userPublicKey === undefined && input.userSignature === undefined && input.timestamp === undefined) {
    return { ok: true, request: { kind: "service", fileHash } };
  }

  if (!isRawPublicKey(input.userPublicKey) || !isSignatureString(input.userSignature)) {
    return { ok: false, error: "Invalid user key or signature" };
  }
  if (isServiceKey(input.userPublicKey)) {
    // A service signature over `<hash>:<email>:<t>` (v2) must never be
    // replayable as a "user" signature, so service keys cannot be user keys.
    return { ok: false, error: "User key must not be a service key" };
  }
  if (typeof input.timestamp !== "number" || !Number.isInteger(input.timestamp)) {
    return { ok: false, error: "timestamp must be an integer (ms since epoch)" };
  }
  if (Math.abs(input.timestamp - now) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: "timestamp is too far from server time" };
  }
  return {
    ok: true,
    request: {
      kind: "user",
      fileHash,
      timestamp: input.timestamp,
      user: { publicKey: input.userPublicKey, signature: input.userSignature },
    },
  };
}
