import { NextResponse } from "next/server";
import { corsHeaders, corsPreflight, parseNonNegativeInt } from "@/lib/http";
import { buildInclusionProof } from "@/lib/log-head";
import { createRateLimiter, getClientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { getCounterStore, getLogStore } from "@/lib/redis";

const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;
const LIMIT = 60;
const limiter = createRateLimiter(getCounterStore(), { limit: LIMIT, windowSeconds: 60, prefix: "rl:log-proof" });

/**
 * GET /api/log/proof?index=N   or   ?signature=<record signature>
 *   →  { index, size, root, leafHash, proof[], head }
 *
 * `head` is a signed tree head over the same tree as `root`, so the proof is
 * checkable on its own: audit path to `root`, then the head signature.
 */
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return corsPreflight(["GET"]);
}

export async function GET(request: Request): Promise<Response> {
  const decision = await limiter(getClientIp(request));
  if (!decision.allowed) return rateLimitedResponse(decision, LIMIT, corsHeaders());

  const url = new URL(request.url);
  const indexParam = url.searchParams.get("index");
  const signature = url.searchParams.get("signature");

  const fail = (error: string, status: number): Response =>
    NextResponse.json({ error }, { status, headers: corsHeaders() });

  if (indexParam !== null && signature !== null) return fail("Provide index or signature, not both", 400);

  try {
    const log = getLogStore();
    let index: number | null = null;
    if (indexParam !== null) {
      index = parseNonNegativeInt(indexParam);
      if (index === null) return fail("index must be a non-negative integer", 400);
    } else if (signature !== null) {
      if (!SIGNATURE_RE.test(signature)) return fail("Invalid signature", 400);
      index = await log.indexOf(signature);
      if (index === null) return fail("Record not in log", 404);
    } else {
      return fail("index or signature is required", 400);
    }

    const proof = await buildInclusionProof(log, index);
    if (!proof) return fail("No such entry", 404);
    return NextResponse.json(proof, { status: 200, headers: corsHeaders({ "Cache-Control": "no-store" }) });
  } catch (error) {
    console.error("[log/proof] failed", error);
    return fail("Log unavailable", 503);
  }
}
