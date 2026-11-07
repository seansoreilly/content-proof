/**
 * Zero-width characters (U+200B to U+200F), bidi embeddings and overrides
 * (U+202A to U+202E), invisible operators (U+2060 to U+2064), bidi isolates
 * (U+2066 to U+2069) and the byte order mark (U+FEFF). Written as escapes so
 * the source shows what it matches.
 */
const HIDDEN_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * Text as it should be read, not as it was typed: bidi overrides and
 * zero-width characters can make `moc.live@x` look like a trusted address.
 * Used for display only; verification always works on the raw bytes.
 */
export function stripHiddenChars(text: string): string {
  return text.replace(HIDDEN_CHARS, "");
}
