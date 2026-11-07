import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { isSignatureString } from "@/lib/record";
import { getRecordStore } from "@/lib/redis";

/**
 * GET /api/sig/[signature]  →  stored signature record, if the service keeps one.
 *
 * Records are self-contained, so this is a convenience for recovering a lost
 * QR code or for integrators, not part of the verification path.
 */
export const OPTIONS = publicOptions(["GET"]);

export const GET = publicRoute(
  {
    failureStatus: 503,
    failureMessage: "Record storage unavailable",
    logTag: "[sig] record store unavailable",
    logLevel: "warn",
  },
  async (_request: Request, { params }: { params: Promise<{ signature: string }> }): Promise<Response> => {
    const { signature } = await params;
    if (!isSignatureString(signature)) return jsonResponse({ error: "Invalid signature id" }, 400);

    const record = await getRecordStore().get(signature);
    if (!record) return jsonResponse({ error: "Record not found" }, 404);
    return jsonResponse(record, 200, { "Cache-Control": "public, max-age=3600" });
  }
);
