import { base64UrlToString } from "@/lib/base64";
import type { LegacyPayload } from "@/lib/crypto/verify";
import { decodeRecord, extractPayloadFromUrl, type SignatureRecord } from "@/lib/record";

/** Whatever the verifier managed to load: a current record or a legacy payload. */
export type LoadedInput =
  | { kind: "record"; record: SignatureRecord }
  | { kind: "legacy"; payload: LegacyPayload };

function parseLegacy(encoded: string): LegacyPayload | null {
  try {
    const parsed = JSON.parse(base64UrlToString(encoded)) as Partial<LegacyPayload>;
    if (
      typeof parsed.signature === "string" &&
      typeof parsed.publicKey === "string" &&
      typeof parsed.timestamp === "number"
    ) {
      return { signature: parsed.signature, publicKey: parsed.publicKey, timestamp: parsed.timestamp };
    }
  } catch {
    // not a legacy payload
  }
  return null;
}

/**
 * Accept anything a person might paste into the verifier: a full verification
 * link, a bare `#P=` fragment, a raw v2 record, a legacy `?data=` link, or a
 * legacy base64url JSON blob.
 */
export function parseVerificationInput(text: string): LoadedInput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fromFragment = extractPayloadFromUrl(trimmed);
  const record = decodeRecord(fromFragment ?? trimmed);
  if (record) return { kind: "record", record };

  let legacyEncoded = trimmed;
  if (trimmed.includes("data=")) {
    try {
      legacyEncoded = new URL(trimmed, "https://placeholder.invalid").searchParams.get("data") ?? "";
    } catch {
      return null;
    }
  }
  const payload = parseLegacy(legacyEncoded);
  return payload ? { kind: "legacy", payload } : null;
}
