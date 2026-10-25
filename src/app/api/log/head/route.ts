import { NextResponse } from "next/server";
import { corsHeaders, corsPreflight } from "@/lib/http";
import { buildSignedLogHead } from "@/lib/log-head";
import { createRateLimiter, getClientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { getCounterStore, getLogStore } from "@/lib/redis";

const LIMIT = 60;
const limiter = createRateLimiter(getCounterStore(), { limit: LIMIT, windowSeconds: 60, prefix: "rl:log-head" });

/**
 * GET /api/log/head  →  signed Merkle tree head of the append-only record log.
 *
 * Archive these over time (a cron that commits the JSON to a public repo is
 * enough). Two heads where the later tree is not an extension of the earlier
 * one prove the log was rewritten. No cache: the head must reflect the log now.
 */
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return corsPreflight(["GET"]);
}

export async function GET(request: Request): Promise<Response> {
  const decision = await limiter(getClientIp(request));
  if (!decision.allowed) return rateLimitedResponse(decision, LIMIT, corsHeaders());

  try {
    const head = await buildSignedLogHead(getLogStore());
    return NextResponse.json(head, { status: 200, headers: corsHeaders({ "Cache-Control": "no-store" }) });
  } catch (error) {
    console.error("[log/head] failed", error);
    return NextResponse.json({ error: "Log head unavailable" }, { status: 503, headers: corsHeaders() });
  }
}
