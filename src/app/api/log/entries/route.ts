import { NextResponse } from "next/server";
import { encodeRecord } from "@/lib/record";
import { getLogStore } from "@/lib/redis";

const MAX_PAGE = 500;

/**
 * GET /api/log/entries?from=0&limit=100  →  a page of the append-only log.
 *
 * Lets auditors mirror the whole log and recompute the tree head themselves.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const from = Number(url.searchParams.get("from") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "100");
  if (!Number.isInteger(from) || from < 0 || !Number.isInteger(limit) || limit < 1) {
    return NextResponse.json({ error: "from and limit must be non-negative integers" }, { status: 400 });
  }

  try {
    const log = getLogStore();
    const size = await log.size();
    const entries = await log.range(from, Math.min(limit, MAX_PAGE));
    return NextResponse.json(
      { from, size, entries: entries.map(encodeRecord) },
      { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[log/entries] failed", error);
    return NextResponse.json({ error: "Log unavailable" }, { status: 503 });
  }
}
