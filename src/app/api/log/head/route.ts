import { NextResponse } from "next/server";
import { buildSignedLogHead } from "@/lib/log-head";
import { getLogStore } from "@/lib/redis";

/**
 * GET /api/log/head  →  signed Merkle tree head of the append-only record log.
 *
 * Archive these over time (a cron that commits the JSON to a public repo is
 * enough). Two heads where the later tree is not an extension of the earlier
 * one prove the log was rewritten. No cache: the head must reflect the log now.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const head = await buildSignedLogHead(getLogStore());
    return NextResponse.json(head, {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[log/head] failed", error);
    return NextResponse.json({ error: "Log head unavailable" }, { status: 503 });
  }
}
