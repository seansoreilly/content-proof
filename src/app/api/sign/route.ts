import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { signFileHash } from "@/lib/crypto/ed25519";
import { createRateLimiter, rateLimitedResponse } from "@/lib/rate-limit";
import { getCounterStore, getLogStore, getRecordStore } from "@/lib/redis";

const HASH_HEX_RE = /^[0-9a-fA-F]{64}$/;

// 30 signatures per account per minute is generous for a human and a hard
// ceiling for anything scripted.
const limiter = createRateLimiter(getCounterStore(), {
  limit: 30,
  windowSeconds: 60,
  prefix: "rl:sign",
});

/**
 * POST /api/sign  { fileHash: <sha256 hex> }  →  { record }
 *
 * The file itself never reaches the server; the browser hashes it and the
 * service attests to (hash, account, time).
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
    const fileHash = (body as { fileHash?: unknown } | null)?.fileHash;
    if (typeof fileHash !== "string" || !HASH_HEX_RE.test(fileHash)) {
      return NextResponse.json({ error: "Invalid fileHash" }, { status: 400 });
    }

    const record = signFileHash(fileHash, email);

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
