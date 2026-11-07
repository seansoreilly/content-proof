import { verifyRecord } from "@/lib/crypto/verify";
import { buildPublicKeysJson } from "@/lib/keys";
import { readJsonBody } from "@/lib/json-body";
import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { hashB64urlToHex, isHashHex, parseRecordObject, type SignatureRecord } from "@/lib/record";
import { parseRecordInput } from "@/lib/verifier";

export const OPTIONS = publicOptions(["POST"]);

/**
 * POST /api/verify  →  { valid, keyId, userSigned, userKey, reason }
 *
 * Server-side counterpart of the browser verifier for integrators who would
 * rather not ship crypto. The body is either the record as a JSON object
 * `{ v, k, h, e, t, s[, u, us] }` or `{ "record": "<compact record or
 * verification link>" }`, the form people actually have to hand. Either may
 * add `"fileHash"` (SHA-256, 64 hex characters): the server never sees the
 * file, so without it this only proves the record is one the service issued
 * and the caller must still compare the record's hash with their file; with
 * it the comparison happens here and a different file comes back as
 * `hash-mismatch`.
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
    // Any content type: this endpoint uses no cookies, and cross-origin
    // integrators may post text/plain to skip the preflight. Size is capped.
    const read = await readJsonBody(request);
    if (!read.ok) return jsonResponse({ error: read.error }, read.status);
    const body = read.value;
    const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    let record: SignatureRecord;
    if (typeof fields.record === "string") {
      const parsed = parseRecordInput(fields.record);
      if (!parsed.ok) return jsonResponse({ error: `Invalid record: ${parsed.message}` }, 400);
      record = parsed.record;
    } else {
      const parsed = parseRecordObject(body);
      if (!parsed) return jsonResponse({ error: "Invalid signature record" }, 400);
      record = parsed;
    }

    const { fileHash } = fields;
    if (fileHash !== undefined && !isHashHex(fileHash)) {
      return jsonResponse({ error: "Invalid fileHash: expected a SHA-256 digest as 64 hex characters" }, 400);
    }

    const result = verifyRecord(record, fileHash ?? hashB64urlToHex(record.h), buildPublicKeysJson());
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
