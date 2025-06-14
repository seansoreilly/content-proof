import { NextResponse } from "next/server";
import { generateSignature } from "@/lib/crypto/ed25519";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

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

    const timestamp = Date.now();
    const signature = generateSignature({ fileHash, gmail: session.user.email!, timestamp });

    return NextResponse.json(signature, { status: 200 });
  } catch (err) {
    console.error("Signature generation failed", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
} 