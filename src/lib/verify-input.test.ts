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

  it("tolerates the wrapping and line breaks that mail and chat clients add", () => {
    const link = createVerificationUrl(encodeRecord(record), "https://cp.app");
    const expected = { kind: "record", record };
    expect(parseVerificationInput(`<${link}>`)).toEqual(expected);
    expect(parseVerificationInput(`"${link}"`)).toEqual(expected);
    expect(parseVerificationInput(`[verify it](${link})`)).toEqual(expected);
    expect(parseVerificationInput(`Here is the record:\n${link}\nand another ${link}`)).toEqual(expected);
    const mid = Math.floor(link.length / 2);
    expect(parseVerificationInput(`${link.slice(0, mid)}\n${link.slice(mid)}`)).toEqual(expected);
    expect(parseVerificationInput(link.replace(/~/g, "%7E"))).toEqual(expected);
  });

  it("keeps a %7E inside the email distinct from the separators", () => {
    const tilde = { ...record, e: "a~b@example.com" };
    expect(parseVerificationInput(encodeRecord(tilde))).toEqual({ kind: "record", record: tilde });
  });

  it("rejects non-canonical version and timestamp encodings", () => {
    const encoded = encodeRecord(record);
    expect(parseVerificationInput(encoded.replace(/^2~/, "02~"))).toBeNull();
    expect(parseVerificationInput(encoded.replace(`~${record.t}~`, `~0${record.t}~`))).toBeNull();
    expect(parseVerificationInput(encoded.replace(`~${record.t}~`, `~${record.t}.0~`))).toBeNull();
  });

  it("returns null for junk", () => {
    expect(parseVerificationInput("")).toBeNull();
    expect(parseVerificationInput("hello there")).toBeNull();
    expect(parseVerificationInput("https://cp.app/verify")).toBeNull();
    expect(parseVerificationInput(stringToBase64Url(JSON.stringify({ nope: true })))).toBeNull();
  });
});
