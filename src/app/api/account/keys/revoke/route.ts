import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { isRawPublicKey } from "@/lib/record";
import { getUserKeyRegistry } from "@/lib/redis";

/**
 * POST /api/account/keys/revoke  { publicKey }  →  `{ key }`
 *
 * Permanently revokes one of the signed-in account's browser keys: the
 * service will not countersign with it again, and the public status endpoint
 * reports it as revoked. Only the account's own keys can be revoked; any
 * other key is a 404, whoever holds it. Revoking twice is harmless and keeps
 * the original time. Records already issued stay valid; verifiers decide
 * what a later revocation means for them.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const publicKey = typeof body === "object" && body !== null ? (body as { publicKey?: unknown }).publicKey : undefined;
    if (!isRawPublicKey(publicKey)) {
      return NextResponse.json({ error: "Invalid publicKey" }, { status: 400 });
    }

    const key = await getUserKeyRegistry().revoke(email, publicKey, Date.now());
    if (!key) return NextResponse.json({ error: "No such key on this account" }, { status: 404 });
    return NextResponse.json({ key }, { status: 200 });
  } catch (error) {
    console.error("[account/keys/revoke] failed", error);
    return NextResponse.json({ error: "Key registry unavailable" }, { status: 503 });
  }
}
