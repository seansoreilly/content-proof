import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { toBase64Url, createVerificationUrl, generateQrCodeDataUrl } from "@/lib/qr";

/**
 * GET /api/qr/[signatureId]
 *
 * Generates a QR code PNG (data URL) that encodes a verification link for the
 * specified signatureId. The signature record must exist in Redis.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ signatureId: string }> }
) {
  const { signatureId } = await params;
  const decodedSignatureId = decodeURIComponent(signatureId ?? "");
  if (!decodedSignatureId) {
    return NextResponse.json({ error: "Missing signatureId" }, { status: 400 });
  }

  try {
    const recordRaw = await redis.get<string>(`signature:${decodedSignatureId}`);
    if (!recordRaw) {
      return NextResponse.json({ error: "Signature not found" }, { status: 404 });
    }

    // Build encoded payload for the verification page (keep it minimal)
    const record = JSON.parse(recordRaw) as {
      publicKey: string;
      timestamp: number;
    };

    const encodedData = toBase64Url({
      signature: decodedSignatureId,
      publicKey: record.publicKey,
      timestamp: record.timestamp,
    });

    const verifyUrl = createVerificationUrl(encodedData);

    const dataUrl = await generateQrCodeDataUrl(verifyUrl, { width: 256 });

    // Return as JSON for flexibility (client can embed <img src="..." />)
    return NextResponse.json({ dataUrl, verifyUrl }, { status: 200 });
  } catch (redisError) {
    console.warn("Redis operation failed in /api/qr:", redisError);
    return NextResponse.json({ 
      error: "QR code generation unavailable - signature data not found" 
    }, { status: 503 });
  }
} 