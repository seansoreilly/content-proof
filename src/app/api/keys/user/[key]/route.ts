import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { isRawPublicKey } from "@/lib/record";
import { getUserKeyRegistry } from "@/lib/redis";

/**
 * GET /api/keys/user/<publicKey>  →  `{ publicKey, known, revokedAt }`
 *
 * Public revocation status of an account holder's browser key, for verifiers
 * deciding how far to trust a version 3 record. Deliberately says nothing
 * about which account the key belongs to: the record already names it, and
 * the endpoint must not turn a bare key into an email address.
 */
export const dynamic = "force-dynamic";

export const OPTIONS = publicOptions(["GET"]);

export const GET = publicRoute(
  {
    limit: 60,
    prefix: "rl:user-key",
    failureStatus: 503,
    failureMessage: "Key registry unavailable",
    logTag: "[keys/user] registry unavailable",
    logLevel: "warn",
  },
  async (_request: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> => {
    const { key } = await params;
    if (!isRawPublicKey(key)) return jsonResponse({ error: "Invalid public key" }, 400);

    const owner = await getUserKeyRegistry().lookup(key);
    // Short cache only: a revocation should reach verifiers quickly.
    return jsonResponse(
      { publicKey: key, known: owner !== null, revokedAt: owner?.revokedAt ?? null },
      200,
      { "Cache-Control": "public, max-age=60" }
    );
  }
);
