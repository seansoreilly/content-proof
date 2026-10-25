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
      typeof parsed.timestamp === "number" &&
      Number.isSafeInteger(parsed.timestamp) &&
      parsed.timestamp > 0
    ) {
      return { signature: parsed.signature, publicKey: parsed.publicKey, timestamp: parsed.timestamp };
    }
  } catch {
    // not a legacy payload
  }
  return null;
}

function parseOne(text: string): LoadedInput | null {
  const fromFragment = extractPayloadFromUrl(text);
  const record = decodeRecord(fromFragment ?? text);
  if (record) return { kind: "record", record };

  let legacyEncoded = text;
  if (text.includes("data=")) {
    try {
      legacyEncoded = new URL(text, "https://placeholder.invalid").searchParams.get("data") ?? "";
    } catch {
      return null;
    }
  }
  const payload = parseLegacy(legacyEncoded);
  return payload ? { kind: "legacy", payload } : null;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/;

/**
 * The forms a pasted link or record commonly arrives in, most literal first:
 * as typed; wrapped in <>, quotes or a markdown link; the first URL out of a
 * longer message; with the line breaks an email client inserted removed; and
 * with a `~` that the clipboard percent-encoded as `%7E`. The last variant is
 * only tried when no literal `~` is present, because inside a record `%7E`
 * is how a `~` in an email address is escaped.
 */
function candidates(text: string): string[] {
  const out: string[] = [text];
  const unwrapped = text.replace(/^[<"'`[(]+/, "").replace(/[>"'`\])]+$/, "");
  const markdown = /\[[^\]]*\]\(([^)]+)\)/.exec(text)?.[1];
  const firstUrl = URL_RE.exec(text)?.[0];
  for (const c of [unwrapped, markdown, firstUrl]) if (c && !out.includes(c)) out.push(c);
  for (const c of [...out]) {
    const compact = c.replace(/\s+/g, "");
    if (!out.includes(compact)) out.push(compact);
  }
  for (const c of [...out]) {
    if (!c.includes("~") && /%7e/i.test(c)) {
      const decoded = c.replace(/%7e/gi, "~");
      if (!out.includes(decoded)) out.push(decoded);
    }
  }
  return out;
}

/**
 * Accept anything a person might paste into the verifier: a full verification
 * link, a bare `#P=` fragment, a raw v2 record, a legacy `?data=` link, or a
 * legacy base64url JSON blob, allowing for the wrapping and line breaks that
 * chat and mail clients add.
 */
export function parseVerificationInput(text: string): LoadedInput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const candidate of candidates(trimmed)) {
    const parsed = parseOne(candidate);
    if (parsed) return parsed;
  }
  return null;
}
