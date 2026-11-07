import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { parseNonNegativeInt } from "@/lib/http";
import type { SignatureRecord } from "@/lib/record";
import { parseCursor } from "@/lib/record-store";
import { getLogStore, getRecordStore } from "@/lib/redis";

const DEFAULT_LIMIT = 20;
// Each record costs one log lookup for its index, so pages stay small.
const MAX_LIMIT = 50;

export const dynamic = "force-dynamic";

export interface AccountRecordEntry {
  record: SignatureRecord;
  /** Position in the transparency log, when it could be found. */
  logIndex?: number;
}

export interface AccountRecordsResponse {
  records: AccountRecordEntry[];
  nextCursor: string | null;
}

/**
 * GET /api/account/records?limit=&cursor=  →  the signed-in account's records, newest first.
 *
 * Same-origin only: it reads the session cookie and returns an account's
 * history, so unlike the public endpoints it carries no CORS headers.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const requested = parseNonNegativeInt(url.searchParams.get("limit"), DEFAULT_LIMIT);
    if (requested === null || requested < 1) {
      return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
    }
    const limit = Math.min(requested, MAX_LIMIT);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    if (cursor !== undefined && !parseCursor(cursor)) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const page = await getRecordStore().listByEmail(email, { limit, cursor });

    const log = getLogStore();
    const records = await Promise.all(
      page.records.map(async (record): Promise<AccountRecordEntry> => {
        // The log index is a nicety on this page; a log outage must not hide the list.
        const logIndex = await log.indexOf(record.s).catch(() => null);
        return logIndex === null ? { record } : { record, logIndex };
      })
    );
    const body: AccountRecordsResponse = { records, nextCursor: page.nextCursor };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[account/records] failed", error);
    return NextResponse.json({ error: "Record storage unavailable" }, { status: 503 });
  }
}
