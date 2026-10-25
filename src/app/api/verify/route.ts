import { NextResponse } from "next/server";
import { verifyRecord } from "@/lib/crypto/verify";
import { corsHeaders, corsPreflight } from "@/lib/http";
import { buildPublicKeysJson } from "@/lib/keys";
import { createRateLimiter, getClientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { hashB64urlToHex, parseRecordObject } from "@/lib/record";
import { getCounterStore } from "@/lib/redis";

const LIMIT = 60;
const limiter = createRateLimiter(getCounterStore(), {
  limit: LIMIT,
  windowSeconds: 60,
  prefix: "rl:verify",
});

export function OPTIONS(): Response {
  return corsPreflight(["POST"]);
}

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
    const decision = await limiter(getClientIp(request));
    if (!decision.allowed) return rateLimitedResponse(decision, LIMIT, corsHeaders());

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders() });
    }
    const record = parseRecordObject(body);
    if (!record) {
      return NextResponse.json({ error: "Invalid signature record" }, { status: 400, headers: corsHeaders() });
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
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("[verify] failed", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: corsHeaders() });
  }
}
