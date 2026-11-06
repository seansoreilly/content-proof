import { buildSignedLogHead } from "@/lib/log-head";
import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { getLogStore } from "@/lib/redis";

/**
 * GET /api/log/head  →  signed Merkle tree head of the append-only record log.
 *
 * Archive these over time (a cron that commits the JSON to a public repo is
 * enough). Two heads where the later tree is not an extension of the earlier
 * one prove the log was rewritten. No cache: the head must reflect the log now.
 */
export const dynamic = "force-dynamic";

export const OPTIONS = publicOptions(["GET"]);

export const GET: (request: Request) => Promise<Response> = publicRoute(
  {
    limit: 60,
    prefix: "rl:log-head",
    failureStatus: 503,
    failureMessage: "Log head unavailable",
    logTag: "[log/head] failed",
  },
  async (): Promise<Response> => {
    const head = await buildSignedLogHead(getLogStore());
    return jsonResponse(head, 200, { "Cache-Control": "no-store" });
  }
);
