import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { InvalidUserSignatureError, signFileHash } from "@/lib/crypto/ed25519";
import { jsonRequestHeadersError, readJsonBody } from "@/lib/json-body";
import { getServiceRawPublicKeys } from "@/lib/keys";
import { createRateLimiter, rateLimitedResponse } from "@/lib/rate-limit";
import { getCounterStore, getLogStore, getRecordStore, getUserKeyRegistry } from "@/lib/redis";
import { parseSignRequest } from "@/lib/sign-request";
import { isCorruptKeyEntryError } from "@/lib/user-key-registry";
import { USER_KEY_REVOKED_MESSAGE } from "@/lib/user-key-status";

// 30 signatures per account per minute is generous for a human and a hard
// ceiling for anything scripted.
const LIMIT = 30;
const limiter = createRateLimiter(getCounterStore(), {
  limit: LIMIT,
  windowSeconds: 60,
  prefix: "rl:sign",
});

/** True when the base64url raw key equals the raw key of any published service key. */
function isServiceKey(userPublicKey: string): boolean {
  return getServiceRawPublicKeys().has(userPublicKey);
}

/**
 * POST /api/sign
 *   { fileHash }                                              → version 2 record
 *   { fileHash, timestamp, userPublicKey, userSignature }     → version 3 record
 *
 * Responds `{ record, logIndex, logged }`. Storage failures do not block
 * signing: `logged` is false and `logIndex` null when the record could not be
 * stored or appended to the transparency log.
 *
 * The file itself never reaches the server; the browser hashes it. For a
 * version 3 record the browser also signs `<hash>:<email>:<timestamp>` with the
 * account holder's own key, so it must choose the timestamp; the server accepts
 * it only within a small clock-skew window, verifies the user signature, then
 * countersigns.
 *
 * Version 3 requests are also checked against the key registry: a revoked key,
 * or a key already registered to another account, is refused with 403, and a
 * corrupt registry entry with 503. Any other registry failure (an outage) is
 * logged and signing proceeds (fail open, like the
 * rate limiter), because the registry guards key hygiene, not the validity of
 * the signature itself.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Before the limiter: a cross-site form post or an announced oversized
    // body must not even spend the budget.
    const headersError = jsonRequestHeadersError(request);
    if (headersError) return NextResponse.json({ error: headersError.error }, { status: headersError.status });

    const decision = await limiter(email.toLowerCase());
    if (!decision.allowed) return rateLimitedResponse(decision, LIMIT);

    const body = await readJsonBody(request);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
    const now = Date.now();
    const parsed = parseSignRequest(body.value, now, isServiceKey);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const signRequest = parsed.request;
    const timestamp = signRequest.kind === "user" ? signRequest.timestamp : now;
    const user = signRequest.kind === "user" ? signRequest.user : undefined;

    if (user) {
      const refusal = await checkUserKey(email, user.publicKey);
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    }

    let record;
    try {
      record = signFileHash(signRequest.fileHash, email, timestamp, user);
    } catch (error) {
      if (error instanceof InvalidUserSignatureError) {
        return NextResponse.json({ error: "User signature does not verify" }, { status: 400 });
      }
      throw error;
    }

    let logIndex: number | null = null;
    try {
      await getRecordStore().put(record);
      logIndex = await getLogStore().append(record);
    } catch (storeError) {
      // The record is self-contained and verifies without storage, so the user
      // still gets it. But a missing record or log entry must never be silent:
      // log it loudly and tell the client through `logged`.
      console.error("[sign] record NOT persisted / not in transparency log", storeError);
    }

    if (user) await recordUserKey(email, user.publicKey, now);

    return NextResponse.json({ record, logIndex, logged: logIndex !== null }, { status: 200 });
  } catch (error) {
    console.error("[sign] failed", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/** Why this account may not sign with the key, as a status and message, or null to proceed. */
async function checkUserKey(email: string, publicKey: string): Promise<{ status: 403 | 503; error: string } | null> {
  let owner;
  try {
    owner = await getUserKeyRegistry().lookup(publicKey);
  } catch (error) {
    if (isCorruptKeyEntryError(error)) {
      // The unreadable entry may have recorded a revocation; do not guess.
      console.error("[sign] key registry entry is corrupt; refusing", error);
      return { status: 503, error: "Signing key status unavailable" };
    }
    console.error("[sign] key registry lookup failed; signing anyway", error);
    return null;
  }
  if (!owner) return null;
  if (owner.revokedAt !== undefined) return { status: 403, error: USER_KEY_REVOKED_MESSAGE };
  if (owner.email !== email.toLowerCase()) {
    return { status: 403, error: "This signing key is registered to another account" };
  }
  return null;
}

/**
 * Record the key's first and last use. Runs after signing and never fails the
 * request. The registry itself refuses to un-revoke or re-home a key, so a
 * revocation racing this request cannot be undone by it.
 */
async function recordUserKey(email: string, publicKey: string, now: number): Promise<void> {
  try {
    const result = await getUserKeyRegistry().touch(email, publicKey, now);
    if (result !== "recorded") console.warn(`[sign] key registry did not record the key: ${result}`);
  } catch (error) {
    console.error("[sign] key registry update failed", error);
  }
}
