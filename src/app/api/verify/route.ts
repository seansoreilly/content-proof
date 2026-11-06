import { verifyRecord } from "@/lib/crypto/verify";
import { buildPublicKeysJson } from "@/lib/keys";
import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { hashB64urlToHex, parseRecordObject } from "@/lib/record";

export const OPTIONS = publicOptions(["POST"]);

/**
 * POST /api/verify  { v, k, h, e, t, s }  →  { valid, keyId?, reason? }
 *
 * Server-side counterpart of the browser verifier for integrators who would
 * rather not ship crypto. The server has no file, so this checks that the
 * record is genuinely one the service issued; the caller still compares the
 * record's hash with the file they hold.
 */
export const POST = publicRoute(
  {
    limit: 60,
    prefix: "rl:verify",
    failureStatus: 500,
    failureMessage: "Internal Server Error",
    logTag: "[verify] failed",
  },
  async (request: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    const record = parseRecordObject(body);
    if (!record) return jsonResponse({ error: "Invalid signature record" }, 400);

    const result = verifyRecord(record, hashB64urlToHex(record.h), buildPublicKeysJson());
    return jsonResponse(
      {
        valid: result.ok,
        keyId: result.keyId ?? null,
        userSigned: result.userSigned ?? false,
        userKey: result.userKey ?? null,
        reason: result.reason ?? null,
      },
      200
    );
  }
);
