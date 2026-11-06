import { getSigningKeyPair } from "@/lib/keys";
import { jsonResponse, publicOptions, publicRoute } from "@/lib/public-route";
import { getLogStore, storageStatus } from "@/lib/redis";

/**
 * GET /api/health  →  `{ok, storage: {durable, backend}, log: {size}, keyId}`.
 *
 * Lets an operator or monitor see at a glance whether the deployment is on
 * durable storage (the archived log heads all reporting size 0 suggested it
 * was not), how large the transparency log is, and which key is signing. It
 * reports problems in the body instead of failing, so a missing key or an
 * unreachable log still answers 200 with what is known.
 */
export const dynamic = "force-dynamic";

export const OPTIONS = publicOptions(["GET"]);

function currentKeyId(): string | null {
  try {
    return getSigningKeyPair().keyId;
  } catch {
    // Production without ED25519_* configured: signing is down, health still answers.
    return null;
  }
}

async function logStatus(): Promise<{ size: number } | { size: null; error: "unavailable" }> {
  try {
    return { size: await getLogStore().size() };
  } catch (error) {
    console.warn("[health] log size unavailable", error);
    return { size: null, error: "unavailable" };
  }
}

export const GET: (request: Request) => Promise<Response> = publicRoute(
  {
    limit: 60,
    prefix: "rl:health",
    failureStatus: 503,
    failureMessage: "Health check unavailable",
    logTag: "[health] failed",
  },
  async (): Promise<Response> => {
    const body = {
      ok: true,
      storage: storageStatus(),
      log: await logStatus(),
      keyId: currentKeyId(),
    };
    return jsonResponse(body, 200, { "Cache-Control": "no-store" });
  }
);
