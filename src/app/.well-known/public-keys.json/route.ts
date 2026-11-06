import { corsHeaders } from "@/lib/http";
import { buildPublicKeysJson } from "@/lib/keys";
import { publicOptions, publicRoute } from "@/lib/public-route";

/**
 * GET /.well-known/public-keys.json
 *
 * The one document every verifier must trust. Served fresh on each request so
 * a key rotation is visible immediately, and with permissive CORS so
 * third-party verifiers can fetch it from the browser.
 */
export const dynamic = "force-dynamic";

export const OPTIONS = publicOptions(["GET"]);

export const GET = publicRoute(
  {
    failureStatus: 503,
    failureMessage: "Signing keys are not configured",
    logTag: "[well-known] keys unavailable",
  },
  async (): Promise<Response> => {
    // Built by hand rather than with jsonResponse to keep the explicit charset.
    return new Response(JSON.stringify(buildPublicKeysJson()), {
      status: 200,
      headers: corsHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
      }),
    });
  }
);
