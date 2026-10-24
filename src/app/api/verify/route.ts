import { NextResponse } from "next/server";
import { verifyRecord } from "@/lib/crypto/verify";
import { buildPublicKeysJson } from "@/lib/keys";
import { createRateLimiter, getClientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { hashB64urlToHex, parseRecordObject } from "@/lib/record";
import { getCounterStore } from "@/lib/redis";

const limiter = createRateLimiter(getCounterStore(), {
  limit: 60,
  windowSeconds: 60,
  prefix: "rl:verify",
});

/**
 * POST /api/verify  { v, k, h, e, t, s }  →  { valid, keyId?, reason? }
 *
 * Server-side counterpart of the browser verifier for integrators who would
 * rather not ship crypto. The server has no file, so this checks that the
 * record is genuinely one the service issued; the caller still compares the
 * record's hash with the file they hold.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { allowed } = await limiter(getClientIp(request));
    if (!allowed) return rateLimitedResponse();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const record = parseRecordObject(body);
    if (!record) {
      return NextResponse.json({ error: "Invalid signature record" }, { status: 400 });
    }

    const result = verifyRecord(record, hashB64urlToHex(record.h), buildPublicKeysJson());
    return NextResponse.json(
      {
        valid: result.ok,
        keyId: result.keyId ?? null,
        userSigned: result.userSigned ?? false,
        userKey: result.userKey ?? null,
        reason: result.reason ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[verify] failed", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
