import { NextResponse } from "next/server";
import { buildPublicKeysJson } from "@/lib/keys";

/**
 * GET /.well-known/public-keys.json
 *
 * The one document every verifier must trust. Served fresh on each request so
 * a key rotation is visible immediately, and with permissive CORS so
 * third-party verifiers can fetch it from the browser.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const body = buildPublicKeysJson();
    return new NextResponse(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    console.error("[well-known] keys unavailable", error);
    return NextResponse.json({ error: "Signing keys are not configured" }, { status: 503 });
  }
}
