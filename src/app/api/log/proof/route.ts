import { NextResponse } from "next/server";
import { buildInclusionProof } from "@/lib/log-head";
import { getLogStore } from "@/lib/redis";

const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

/**
 * GET /api/log/proof?index=N   or   ?signature=<record signature>
 *   →  { index, size, root, leaf, proof[] }
 *
 * Together with a signed tree head this proves a record is in the log.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const indexParam = url.searchParams.get("index");
  const signature = url.searchParams.get("signature");

  try {
    const log = getLogStore();
    let index: number | null = null;
    if (indexParam !== null) {
      index = Number(indexParam);
      if (!Number.isInteger(index) || index < 0) {
        return NextResponse.json({ error: "index must be a non-negative integer" }, { status: 400 });
      }
    } else if (signature !== null) {
      if (!SIGNATURE_RE.test(signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
      }
      index = await log.indexOf(signature);
      if (index === null) {
        return NextResponse.json({ error: "Record not in log" }, { status: 404 });
      }
    } else {
      return NextResponse.json({ error: "index or signature is required" }, { status: 400 });
    }

    const proof = await buildInclusionProof(log, index);
    if (!proof) return NextResponse.json({ error: "No such entry" }, { status: 404 });
    return NextResponse.json(proof, {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[log/proof] failed", error);
    return NextResponse.json({ error: "Log unavailable" }, { status: 503 });
  }
}
