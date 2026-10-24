import { NextResponse } from "next/server";
import { getRecordStore } from "@/lib/redis";

const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

/**
 * GET /api/sig/[signature]  →  stored signature record, if the service keeps one.
 *
 * Records are self-contained, so this is a convenience for recovering a lost
 * QR code or for integrators, not part of the verification path.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ signature: string }> }
): Promise<Response> {
  const { signature } = await params;
  if (!SIGNATURE_RE.test(signature ?? "")) {
    return NextResponse.json({ error: "Invalid signature id" }, { status: 400 });
  }

  try {
    const record = await getRecordStore().get(signature);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json(record, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    console.warn("[sig] record store unavailable", error);
    return NextResponse.json({ error: "Record storage unavailable" }, { status: 503 });
  }
}
