import { parseNonNegativeInt } from "@/lib/http";
import { recordLeafHash } from "@/lib/log-verify";
import { bytesToHex } from "@/lib/base64";
import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { getLogStore } from "@/lib/redis";

const MAX_PAGE = 500;
const DEFAULT_LIMIT = 100;

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

export const OPTIONS = publicOptions(["GET"]);

export const GET = publicRoute(
  {
    limit: 30,
    prefix: "rl:log-entries",
    failureStatus: 503,
    failureMessage: "Log unavailable",
    logTag: "[log/entries] failed",
  },
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const from = parseNonNegativeInt(url.searchParams.get("from"), 0);
    const requested = parseNonNegativeInt(url.searchParams.get("limit"), DEFAULT_LIMIT);
    if (from === null || requested === null || requested < 1) {
      return jsonResponse({ error: "from must be a non-negative integer and limit a positive integer" }, 400);
    }
    const limit = Math.min(requested, MAX_PAGE);

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
    return jsonResponse({ from, limit, size, entries }, 200, { "Cache-Control": "no-store" });
  }
);
