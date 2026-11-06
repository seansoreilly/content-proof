import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { InvalidUserSignatureError, signFileHash } from "@/lib/crypto/ed25519";
import { getServiceRawPublicKeys } from "@/lib/keys";
import { createRateLimiter, rateLimitedResponse } from "@/lib/rate-limit";
import { getCounterStore, getLogStore, getRecordStore } from "@/lib/redis";
import { parseSignRequest } from "@/lib/sign-request";

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
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decision = await limiter(email.toLowerCase());
    if (!decision.allowed) return rateLimitedResponse(decision, LIMIT);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const now = Date.now();
    const parsed = parseSignRequest(body, now, isServiceKey);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const signRequest = parsed.request;
    const timestamp = signRequest.kind === "user" ? signRequest.timestamp : now;
    const user = signRequest.kind === "user" ? signRequest.user : undefined;

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

    return NextResponse.json({ record, logIndex, logged: logIndex !== null }, { status: 200 });
  } catch (error) {
    console.error("[sign] failed", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
