import { parseNonNegativeInt } from "@/lib/http";
import { buildInclusionProof } from "@/lib/log-head";
import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { isSignatureString } from "@/lib/record";
import { getLogStore } from "@/lib/redis";

/**
 * GET /api/log/proof?index=N   or   ?signature=<record signature>
 *   →  { index, size, root, leafHash, proof[], head }
 *
 * `head` is a signed tree head over the same tree as `root`, so the proof is
 * checkable on its own: audit path to `root`, then the head signature.
 */
export const dynamic = "force-dynamic";

export const OPTIONS = publicOptions(["GET"]);

const fail = (error: string, status: number): Response => jsonResponse({ error }, status);

export const GET = publicRoute(
  {
    limit: 60,
    prefix: "rl:log-proof",
    failureStatus: 503,
    failureMessage: "Log unavailable",
    logTag: "[log/proof] failed",
  },
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const indexParam = url.searchParams.get("index");
    const signature = url.searchParams.get("signature");

    if (indexParam !== null && signature !== null) return fail("Provide index or signature, not both", 400);

    const log = getLogStore();
    let index: number | null = null;
    if (indexParam !== null) {
      index = parseNonNegativeInt(indexParam);
      if (index === null) return fail("index must be a non-negative integer", 400);
    } else if (signature !== null) {
      if (!isSignatureString(signature)) return fail("Invalid signature", 400);
      index = await log.indexOf(signature);
      if (index === null) return fail("Record not in log", 404);
    } else {
      return fail("index or signature is required", 400);
    }

    const proof = await buildInclusionProof(log, index);
    if (!proof) return fail("No such entry", 404);
    return jsonResponse(proof, 200, { "Cache-Control": "no-store" });
  }
);
