import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/test/fixtures";
import { isHashHex } from "@/lib/record";
import { MAX_CLOCK_SKEW_MS, parseSignRequest } from "@/lib/sign-request";

const NOW = 1_760_000_000_000;
const fileHash = sha256Hex("file");
const userPublicKey = "A".repeat(43);
const userSignature = "B".repeat(86);
const notService = (): boolean => false;
const v3 = { fileHash, timestamp: NOW, userPublicKey, userSignature };

function errorOf(body: unknown, isServiceKey: (k: string) => boolean = notService): string | undefined {
  const result = parseSignRequest(body, NOW, isServiceKey);
  return result.ok ? undefined : result.error;
}

describe("isHashHex", () => {
  it("accepts 64 hex characters in either case", () => {
    expect(isHashHex(fileHash)).toBe(true);
    expect(isHashHex(fileHash.toUpperCase())).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of [fileHash.slice(1), `${fileHash}0`, `g${fileHash.slice(1)}`, ` ${fileHash.slice(1)}`, 42, null, undefined, {}]) {
      expect(isHashHex(value)).toBe(false);
    }
  });
});

describe("parseSignRequest", () => {
  it("accepts a bare hash as a service-only (v2) request", () => {
    expect(parseSignRequest({ fileHash }, NOW, notService)).toEqual({ ok: true, request: { kind: "service", fileHash } });
  });

  it("keeps the hash exactly as sent, upper case included", () => {
    const upper = fileHash.toUpperCase();
    expect(parseSignRequest({ fileHash: upper }, NOW, notService)).toEqual({
      ok: true,
      request: { kind: "service", fileHash: upper },
    });
  });

  it("ignores unknown fields", () => {
    expect(parseSignRequest({ fileHash, extra: 1 }, NOW, notService).ok).toBe(true);
  });

  it("rejects a missing or malformed hash, whatever the body shape", () => {
    for (const body of [null, undefined, 5, "str", [], {}, { fileHash: 1 }, { fileHash: "zz" }, { fileHash: fileHash.slice(2) }]) {
      expect(errorOf(body)).toBe("Invalid fileHash");
    }
  });

  it("checks the hash before the user fields", () => {
    expect(errorOf({ ...v3, fileHash: "zz", userPublicKey: "x" })).toBe("Invalid fileHash");
  });

  it("accepts a complete user-signed (v3) request", () => {
    const isServiceKey = vi.fn(() => false);
    expect(parseSignRequest(v3, NOW, isServiceKey)).toEqual({
      ok: true,
      request: { kind: "user", fileHash, timestamp: NOW, user: { publicKey: userPublicKey, signature: userSignature } },
    });
    expect(isServiceKey).toHaveBeenCalledWith(userPublicKey);
  });

  it("treats any one user field as v3 mode and then requires all of them", () => {
    expect(errorOf({ fileHash, timestamp: NOW })).toBe("Invalid user key or signature");
    expect(errorOf({ fileHash, userPublicKey })).toBe("Invalid user key or signature");
    expect(errorOf({ fileHash, userSignature })).toBe("Invalid user key or signature");
    expect(errorOf({ fileHash, userPublicKey, userSignature })).toBe("timestamp must be an integer (ms since epoch)");
  });

  it("treats an explicit null user field as v3 mode", () => {
    expect(errorOf({ fileHash, timestamp: null })).toBe("Invalid user key or signature");
  });

  it("rejects a malformed user key or signature", () => {
    expect(errorOf({ ...v3, userPublicKey: "x" })).toBe("Invalid user key or signature");
    expect(errorOf({ ...v3, userPublicKey: "A".repeat(44) })).toBe("Invalid user key or signature");
    expect(errorOf({ ...v3, userPublicKey: 7 })).toBe("Invalid user key or signature");
    expect(errorOf({ ...v3, userSignature: "B".repeat(85) })).toBe("Invalid user key or signature");
    expect(errorOf({ ...v3, userSignature: `${"B".repeat(85)}+` })).toBe("Invalid user key or signature");
  });

  it("refuses a service key as the user key, before looking at the timestamp", () => {
    const isServiceKey = (k: string): boolean => k === userPublicKey;
    expect(errorOf(v3, isServiceKey)).toBe("User key must not be a service key");
    expect(errorOf({ ...v3, timestamp: "soon" }, isServiceKey)).toBe("User key must not be a service key");
  });

  it("does not consult the service keys for a v2 request or a malformed key", () => {
    const isServiceKey = vi.fn(() => true);
    expect(parseSignRequest({ fileHash }, NOW, isServiceKey).ok).toBe(true);
    expect(errorOf({ ...v3, userPublicKey: "x" }, isServiceKey)).toBe("Invalid user key or signature");
    expect(isServiceKey).not.toHaveBeenCalled();
  });

  it("requires an integer timestamp", () => {
    for (const timestamp of [String(NOW), NOW + 0.5, Number.NaN, Number.POSITIVE_INFINITY, null, true]) {
      expect(errorOf({ ...v3, timestamp })).toBe("timestamp must be an integer (ms since epoch)");
    }
  });

  it("accepts a timestamp exactly at the clock-skew limit on either side", () => {
    expect(errorOf({ ...v3, timestamp: NOW + MAX_CLOCK_SKEW_MS })).toBeUndefined();
    expect(errorOf({ ...v3, timestamp: NOW - MAX_CLOCK_SKEW_MS })).toBeUndefined();
  });

  it("rejects a timestamp just beyond the clock-skew limit", () => {
    expect(MAX_CLOCK_SKEW_MS).toBe(5 * 60 * 1000);
    expect(errorOf({ ...v3, timestamp: NOW + MAX_CLOCK_SKEW_MS + 1 })).toBe("timestamp is too far from server time");
    expect(errorOf({ ...v3, timestamp: NOW - MAX_CLOCK_SKEW_MS - 1 })).toBe("timestamp is too far from server time");
    expect(errorOf({ ...v3, timestamp: NOW - 10 * 60 * 1000 })).toBe("timestamp is too far from server time");
  });
});
