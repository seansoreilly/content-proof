import { NextResponse } from "next/server";
import { verifySignatureAgainstKnownKeys } from "@/lib/crypto/verify";

interface VerifyRequestBody {
  fileHash: string;
  gmail: string;
  timestamp: number;
  signature: string;
}

/**
 * POST /api/verify
 *
 * Verifies that a detached Ed25519 signature was generated for the provided
 * payload (fileHash, gmail, timestamp). The endpoint does **not** require the
 * caller to provide the public key; the server will attempt verification
 * against all known keys (current + historical).
 */
export async function POST(request: Request) {
  try {
    const { fileHash, gmail, timestamp, signature } = (await request.json()) as Partial<VerifyRequestBody>;

    // Basic input validation – all fields must exist and be of the expected type
    if (
      typeof fileHash !== "string" ||
      !/^[0-9a-fA-F]{64}$/.test(fileHash) ||
      typeof gmail !== "string" ||
      !/^.+@gmail\.com$/i.test(gmail) ||
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      typeof signature !== "string" ||
      signature.length === 0
    ) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Reconstruct the signed message (must match the order in generateSignature)
    const message = `${fileHash}:${gmail}:${timestamp}`;

    const matchedPublicKey = verifySignatureAgainstKnownKeys(message, signature);

    return NextResponse.json(
      {
        valid: matchedPublicKey !== null,
        publicKey: matchedPublicKey,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Verification failed", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
} 