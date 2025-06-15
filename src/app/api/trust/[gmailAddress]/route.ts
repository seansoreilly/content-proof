import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

/**
 * GET /api/trust/[gmailAddress]
 *
 * Returns a simple trust level for a given Gmail address based on the number
 * of signatures that the user has generated so far.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gmailAddress: string }> }
) {
  const { gmailAddress } = await params;
  const gmail = decodeURIComponent(gmailAddress ?? "").toLowerCase();

  if (!/^.+@gmail\.com$/i.test(gmail)) {
    return NextResponse.json({ error: "Invalid Gmail address" }, { status: 400 });
  }

  try {
    // Fetch the user's total signature count (default 0)
    const totalSignaturesRaw = (await redis.get<number>(
      `user:${gmail}:signatures`
    )) ?? 0;
    const totalSignatures = typeof totalSignaturesRaw === "number" ? totalSignaturesRaw : Number(totalSignaturesRaw);

    let trustLevel: "none" | "low" | "medium" | "high";
    if (totalSignatures === 0) trustLevel = "none";
    else if (totalSignatures <= 3) trustLevel = "low";
    else if (totalSignatures <= 10) trustLevel = "medium";
    else trustLevel = "high";

    return NextResponse.json({ gmail, totalSignatures, trustLevel }, { status: 200 });
  } catch (redisError) {
    console.warn("Redis operation failed in /api/trust:", redisError);
    // Return default trust level when Redis is unavailable
    return NextResponse.json({ 
      gmail, 
      totalSignatures: 0, 
      trustLevel: "none" as const,
      note: "Trust data unavailable" 
    }, { status: 200 });
  }
} 