import { describe, expect, it } from "vitest";
import { stringToBase64Url } from "@/lib/base64";
import { createVerificationUrl, encodeRecord, hashHexToB64url, type SignatureRecord } from "@/lib/record";
import { parseVerificationInput } from "@/lib/verify-input";
import { sha256Hex } from "@/test/fixtures";

const record: SignatureRecord = {
  v: 2,
  k: "AbCdEfGhIjKlMnOp",
  h: hashHexToB64url(sha256Hex("x")),
  e: "person@example.com",
  t: 1_760_000_000_000,
  s: "B".repeat(86),
};

describe("verifier input parsing", () => {
  it("reads a current record from a full link, a fragment, or the raw payload", () => {
    const encoded = encodeRecord(record);
    expect(parseVerificationInput(createVerificationUrl(encoded, "https://cp.app"))).toEqual({
      kind: "record",
      record,
    });
    expect(parseVerificationInput(`#P=${encoded}`)).toEqual({ kind: "record", record });
    expect(parseVerificationInput(`  ${encoded}\n`)).toEqual({ kind: "record", record });
  });

  it("still reads legacy ?data= links and bare legacy blobs", () => {
    const legacy = { signature: "C".repeat(86), publicKey: "MCowBQYDK2VwAyEA" + "D".repeat(43) + "=", timestamp: 1_750_000_000_000 };
    const blob = stringToBase64Url(JSON.stringify(legacy));
    expect(parseVerificationInput(`https://cp.app/verify?data=${blob}`)).toEqual({ kind: "legacy", payload: legacy });
    expect(parseVerificationInput(blob)).toEqual({ kind: "legacy", payload: legacy });
  });

  it.each([0, -1, 1e20, 1.5])("rejects a legacy payload with timestamp %s", (timestamp) => {
    const legacy = { signature: "C".repeat(86), publicKey: "MCowBQYDK2VwAyEA" + "D".repeat(43) + "=", timestamp };
    expect(parseVerificationInput(stringToBase64Url(JSON.stringify(legacy)))).toBeNull();
  });

  it("returns null for junk", () => {
    expect(parseVerificationInput("")).toBeNull();
    expect(parseVerificationInput("hello there")).toBeNull();
    expect(parseVerificationInput("https://cp.app/verify")).toBeNull();
    expect(parseVerificationInput(stringToBase64Url(JSON.stringify({ nope: true })))).toBeNull();
  });
});
