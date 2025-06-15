import { NextResponse } from "next/server";
import { buildPublicKeysJson } from "@/lib/keys";

/**
 * Expose the server's public keys at the well-known location so that clients
 * can retrieve them for signature verification. The response is publicly
 * cacheable but should always be revalidated to allow key rotations to be
 * picked up quickly.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const body = buildPublicKeysJson();

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
} 