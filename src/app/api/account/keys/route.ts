import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getUserKeyRegistry } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/keys  →  `{ keys: [{ publicKey, firstSeen, lastSeen, revokedAt? }] }`
 *
 * The browser keys the signed-in account has signed with, most recently used
 * first. Same-origin only, like the rest of /api/account. Revoke one with
 * POST /api/account/keys/revoke.
 */
export async function GET(): Promise<Response> {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const keys = await getUserKeyRegistry().list(email);
    return NextResponse.json({ keys }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[account/keys] failed", error);
    return NextResponse.json({ error: "Key registry unavailable" }, { status: 503 });
  }
}
