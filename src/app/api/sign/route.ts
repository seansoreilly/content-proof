import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { InvalidUserSignatureError, signFileHash, type UserSignature } from "@/lib/crypto/ed25519";
import { createRateLimiter, rateLimitedResponse } from "@/lib/rate-limit";
import { isRawPublicKey, isSignatureString } from "@/lib/record";
import { getCounterStore, getLogStore, getRecordStore } from "@/lib/redis";

const HASH_HEX_RE = /^[0-9a-fA-F]{64}$/;
/** How far the client's proposed timestamp may differ from the server clock. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// 30 signatures per account per minute is generous for a human and a hard
// ceiling for anything scripted.
const limiter = createRateLimiter(getCounterStore(), {
  limit: 30,
  windowSeconds: 60,
  prefix: "rl:sign",
});

/**
 * POST /api/sign
 *   { fileHash }                                              → version 2 record
 *   { fileHash, timestamp, userPublicKey, userSignature }     → version 3 record
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

    const { allowed } = await limiter(email.toLowerCase());
    if (!allowed) return rateLimitedResponse();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const input = (body ?? {}) as {
      fileHash?: unknown;
      timestamp?: unknown;
      userPublicKey?: unknown;
      userSignature?: unknown;
    };
    if (typeof input.fileHash !== "string" || !HASH_HEX_RE.test(input.fileHash)) {
      return NextResponse.json({ error: "Invalid fileHash" }, { status: 400 });
    }

    let timestamp = Date.now();
    let user: UserSignature | undefined;
    if (input.userPublicKey !== undefined || input.userSignature !== undefined || input.timestamp !== undefined) {
      if (!isRawPublicKey(input.userPublicKey) || !isSignatureString(input.userSignature)) {
        return NextResponse.json({ error: "Invalid user key or signature" }, { status: 400 });
      }
      if (typeof input.timestamp !== "number" || !Number.isInteger(input.timestamp)) {
        return NextResponse.json({ error: "timestamp must be an integer (ms since epoch)" }, { status: 400 });
      }
      if (Math.abs(input.timestamp - Date.now()) > MAX_CLOCK_SKEW_MS) {
        return NextResponse.json({ error: "timestamp is too far from server time" }, { status: 400 });
      }
      timestamp = input.timestamp;
      user = { publicKey: input.userPublicKey, signature: input.userSignature };
    }

    let record;
    try {
      record = signFileHash(input.fileHash, email, timestamp, user);
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
      // Storage is optional; the record is self-contained.
      console.warn("[sign] record store unavailable", storeError);
    }

    return NextResponse.json({ record, logIndex }, { status: 200 });
  } catch (error) {
    console.error("[sign] failed", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
