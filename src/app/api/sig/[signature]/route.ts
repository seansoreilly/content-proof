import { NextResponse } from "next/server";
import { corsHeaders, corsPreflight } from "@/lib/http";
import { isSignatureString } from "@/lib/record";
import { getRecordStore } from "@/lib/redis";

/**
 * GET /api/sig/[signature]  →  stored signature record, if the service keeps one.
 *
 * Records are self-contained, so this is a convenience for recovering a lost
 * QR code or for integrators, not part of the verification path.
 */
export function OPTIONS(): Response {
  return corsPreflight(["GET"]);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ signature: string }> }
): Promise<Response> {
  const { signature } = await params;
  if (!isSignatureString(signature)) {
    return NextResponse.json({ error: "Invalid signature id" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const record = await getRecordStore().get(signature);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404, headers: corsHeaders() });
    }
    return NextResponse.json(record, {
      status: 200,
      headers: corsHeaders({ "Cache-Control": "public, max-age=3600" }),
    });
  } catch (error) {
    console.warn("[sig] record store unavailable", error);
    return NextResponse.json({ error: "Record storage unavailable" }, { status: 503, headers: corsHeaders() });
  }
}
