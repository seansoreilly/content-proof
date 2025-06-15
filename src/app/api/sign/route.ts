import { NextResponse } from "next/server";
import { generateSignature } from "@/lib/crypto/ed25519";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { redis } from "@/lib/redis";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileHash } = await request.json();
    if (typeof fileHash !== "string" || !/^[0-9a-fA-F]{64}$/.test(fileHash)) {
      return NextResponse.json({ error: "Invalid fileHash" }, { status: 400 });
    }

    const email = session.user.email!;
    const timestamp = Date.now();
    const signature = generateSignature({ fileHash, gmail: email, timestamp });

    // Persist signature data for future lookup (trust, QR, etc.)
    try {
      const signatureKey = `signature:${signature.signature}`;
      await redis.set(signatureKey, JSON.stringify({
        fileHash,
        gmail: email,
        timestamp,
        publicKey: signature.publicKey,
      }));

      // Increment the signer's total signature count (used for trust levels)
      await redis.incr(`user:${email}:signatures`);
    } catch (redisError) {
      console.warn("Redis operation failed in /api/sign:", redisError);
      // Continue without Redis - signature generation still works
    }

    return NextResponse.json({ id: signature.signature, ...signature }, { status: 200 });
  } catch (err) {
    console.error("Signature generation failed", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
} 