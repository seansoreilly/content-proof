import { NextResponse } from "next/server";
import { corsHeaders, corsPreflight, parseNonNegativeInt } from "@/lib/http";
import { recordLeafHash } from "@/lib/log-verify";
import { bytesToHex } from "@/lib/base64";
import { createRateLimiter, getClientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { getCounterStore, getLogStore } from "@/lib/redis";

const MAX_PAGE = 500;
const DEFAULT_LIMIT = 100;
const LIMIT = 30;
const limiter = createRateLimiter(getCounterStore(), { limit: LIMIT, windowSeconds: 60, prefix: "rl:log-entries" });

/**
 * GET /api/log/entries?from=0&limit=100  →  a masked page of the append-only log.
 *
 * Each entry is `{ index, leafHash, h, t, k, v }`: the Merkle leaf hash, the
 * file hash, time, service key id and record version. Emails, user keys and
 * signatures are deliberately omitted so the public feed cannot be used to
 * enumerate who signed what. Auditors who hold a record can still check it
 * against `leafHash` and fetch an inclusion proof.
 */
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return corsPreflight(["GET"]);
}

export async function GET(request: Request): Promise<Response> {
  const decision = await limiter(getClientIp(request));
  if (!decision.allowed) return rateLimitedResponse(decision, LIMIT, corsHeaders());

  const url = new URL(request.url);
  const from = parseNonNegativeInt(url.searchParams.get("from"), 0);
  const requested = parseNonNegativeInt(url.searchParams.get("limit"), DEFAULT_LIMIT);
  if (from === null || requested === null || requested < 1) {
    return NextResponse.json(
      { error: "from must be a non-negative integer and limit a positive integer" },
      { status: 400, headers: corsHeaders() }
    );
  }
  const limit = Math.min(requested, MAX_PAGE);

  try {
    const log = getLogStore();
    const size = await log.size();
    const records = await log.range(from, limit);
    const entries = records.map((record, i) => ({
      index: from + i,
      leafHash: bytesToHex(recordLeafHash(record)),
      h: record.h,
      t: record.t,
      k: record.k,
      v: record.v,
    }));
    return NextResponse.json(
      { from, limit, size, entries },
      { status: 200, headers: corsHeaders({ "Cache-Control": "no-store" }) }
    );
  } catch (error) {
    console.error("[log/entries] failed", error);
    return NextResponse.json({ error: "Log unavailable" }, { status: 503, headers: corsHeaders() });
  }
}
