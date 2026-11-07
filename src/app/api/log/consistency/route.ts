import { parseNonNegativeInt } from "@/lib/http";
import { buildConsistencyProof } from "@/lib/log-head";
import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { getLogStore } from "@/lib/redis";

/**
 * GET /api/log/consistency?from=M[&to=N]  →  { from, to, proof[], head }
 *
 * RFC 6962 consistency proof that the tree of size M (a head someone archived
 * earlier) is a prefix of the current tree, plus a freshly signed head for
 * the current tree. The service only signs current heads, so `to` defaults to
 * the current size and any other value is refused with 400 and the size; the
 * caller can then fetch a new head and retry.
 */
export const dynamic = "force-dynamic";

export const OPTIONS = publicOptions(["GET"]);

const NO_STORE = { "Cache-Control": "no-store" };

export const GET = publicRoute(
  {
    limit: 60,
    prefix: "rl:log-consistency",
    failureStatus: 503,
    failureMessage: "Log unavailable",
    logTag: "[log/consistency] failed",
  },
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const from = parseNonNegativeInt(fromParam);
    const to = toParam === null ? undefined : parseNonNegativeInt(toParam);
    if (from === null || to === null) {
      return jsonResponse({ error: "from is required and from and to must be non-negative integers" }, 400, NO_STORE);
    }
    if (to !== undefined && from > to) return jsonResponse({ error: "from must not exceed to" }, 400, NO_STORE);

    const result = await buildConsistencyProof(getLogStore(), from, to);
    if (!result.ok) return jsonResponse({ error: result.error, size: result.size }, 400, NO_STORE);
    return jsonResponse(result.response, 200, NO_STORE);
  }
);
