import { describe, expect, it } from "vitest";
import {
  RECORD_VERSION,
  buildSignedMessage,
  createVerificationUrl,
  decodeRecord,
  encodeRecord,
  extractPayloadFromUrl,
  hashB64urlToHex,
  hashHexToB64url,
  type SignatureRecord,
} from "@/lib/record";
import { sha256Hex } from "@/test/fixtures";

const sample: SignatureRecord = {
  v: RECORD_VERSION,
  k: "AbCdEfGhIjKlMnOp",
  h: hashHexToB64url(sha256Hex("hello")),
  e: "someone.with~tilde@example.com",
  t: 1_760_000_000_000,
  s: "A".repeat(86),
};

describe("record codec", () => {
  it("round-trips a record through the compact payload", () => {
    const encoded = encodeRecord(sample);
    expect(encoded.startsWith("2~")).toBe(true);
    expect(decodeRecord(encoded)).toEqual(sample);
  });

  it("escapes the tilde separator inside the email", () => {
    const encoded = encodeRecord(sample);
    expect(encoded.split("~")).toHaveLength(6);
    expect(encoded).toContain("%7E");
  });

  it("rejects malformed payloads instead of throwing", () => {
    expect(decodeRecord("")).toBeNull();
    expect(decodeRecord("not a payload")).toBeNull();
    expect(decodeRecord("1~k~h~e~1~s")).toBeNull(); // wrong version
    expect(decodeRecord("2~k~h~e~notanumber~s")).toBeNull();
    expect(decodeRecord("2~k~h~e~1")).toBeNull(); // missing field
    expect(decodeRecord(`2~k~${"x".repeat(10)}~e~1~s`)).toBeNull(); // bad hash length
  });

  it("converts the hash between hex and base64url losslessly", () => {
    const hex = sha256Hex("anything");
    const b64 = hashHexToB64url(hex);
    expect(b64).toHaveLength(43);
    expect(b64).not.toMatch(/[+/=]/);
    expect(hashB64urlToHex(b64)).toBe(hex);
  });

  it("signs exactly the legacy message layout so old signatures stay valid", () => {
    const hex = sha256Hex("file");
    expect(buildSignedMessage(hex, "a@b.co", 123)).toBe(`${hex}:a@b.co:123`);
  });

  it("puts the payload in the URL fragment and reads it back", () => {
    const encoded = encodeRecord(sample);
    const url = createVerificationUrl(encoded, "https://contentproof.app");
    expect(url).toBe(`https://contentproof.app/verify#P=${encoded}`);
    expect(url).not.toContain("?data=");
    expect(extractPayloadFromUrl(url)).toBe(encoded);
    expect(extractPayloadFromUrl(`#P=${encoded}`)).toBe(encoded);
    expect(extractPayloadFromUrl("https://contentproof.app/verify")).toBeNull();
  });

  it("keeps the QR link under the scannability budget for a 30-char email", () => {
    const encoded = encodeRecord({ ...sample, e: "thirty.character.email@gmail.com" });
    const url = createVerificationUrl(encoded, "https://contentproof.app");
    expect(url.length).toBeLessThan(260);
  });
});
