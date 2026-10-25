import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyPair, sha256Hex, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64, type PublicKeysJson } from "@/lib/keyset";
import {
  buildSignedMessage,
  hashHexToB64url,
  type SignatureRecord,
} from "@/lib/record";
import { verifyLegacyPayload, verifyRecord } from "@/lib/crypto/verify";

function publish(...pubs: string[]): PublicKeysJson {
  const entries = pubs.map((publicKey) => {
    const keyId = keyIdFromSpkiBase64(publicKey);
    return [keyId, { keyId, algorithm: "Ed25519" as const, publicKey }] as const;
  });
  return { current: entries[0][0], keys: Object.fromEntries(entries) };
}

describe("signature verification", () => {
  const email = "signer@gmail.com";
  const fileHex = sha256Hex("the real file");

  beforeEach(() => {
    vi.resetModules();
  });

  it("accepts a record produced by the server signer", async () => {
    const pair = stubServerKeys();
    const { signFileHash } = await import("@/lib/crypto/ed25519");
    const record = signFileHash(fileHex, email, 1_760_000_000_000);
    const result = verifyRecord(record, fileHex, publish(pair.publicKeyBase64));
    expect(result).toEqual({ ok: true, keyId: record.k, userSigned: false });
  });

  it("rejects a forged record whose key is not published, even though it self-verifies", () => {
    const rogue = makeKeyPair();
    const t = Date.now();
    const record: SignatureRecord = {
      v: 2,
      k: keyIdFromSpkiBase64(rogue.publicKeyBase64),
      h: hashHexToB64url(fileHex),
      e: "ceo@gmail.com",
      t,
      s: rogue.signHex(buildSignedMessage(fileHex, "ceo@gmail.com", t)),
    };
    const trusted = makeKeyPair();
    const result = verifyRecord(record, fileHex, publish(trusted.publicKeyBase64));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown-key");
  });

  it("rejects a record when the file hash differs", async () => {
    const pair = stubServerKeys();
    const { signFileHash } = await import("@/lib/crypto/ed25519");
    const record = signFileHash(fileHex, email);
    const result = verifyRecord(record, sha256Hex("a different file"), publish(pair.publicKeyBase64));
    expect(result).toMatchObject({ ok: false, reason: "hash-mismatch" });
  });

  it("rejects a record whose email or timestamp was edited after signing", async () => {
    const pair = stubServerKeys();
    const { signFileHash } = await import("@/lib/crypto/ed25519");
    const record = signFileHash(fileHex, email);
    const keys = publish(pair.publicKeyBase64);
    expect(verifyRecord({ ...record, e: "impostor@gmail.com" }, fileHex, keys)).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
    expect(verifyRecord({ ...record, t: record.t + 1 }, fileHex, keys)).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("verifies with a previous key after rotation", async () => {
    const old = stubServerKeys();
    const { signFileHash } = await import("@/lib/crypto/ed25519");
    const record = signFileHash(fileHex, email);
    const fresh = makeKeyPair();
    const keys = publish(fresh.publicKeyBase64, old.publicKeyBase64);
    expect(verifyRecord(record, fileHex, keys).ok).toBe(true);
  });

  it("treats a malformed signature as a failure rather than an exception", () => {
    const pair = makeKeyPair();
    const record: SignatureRecord = {
      v: 2,
      k: keyIdFromSpkiBase64(pair.publicKeyBase64),
      h: hashHexToB64url(fileHex),
      e: email,
      t: 1,
      s: "tooshort",
    };
    expect(verifyRecord(record, fileHex, publish(pair.publicKeyBase64))).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
  });

  describe("legacy query-string payloads", () => {
    const t = 1_750_000_000_000;

    it("accepts a legacy payload only when its embedded key is published", () => {
      const pair = makeKeyPair();
      const payload = {
        signature: pair.signHex(buildSignedMessage(fileHex, email, t)),
        publicKey: pair.publicKeyBase64,
        timestamp: t,
      };
      expect(verifyLegacyPayload(payload, email, fileHex, publish(pair.publicKeyBase64))).toMatchObject({
        ok: true,
      });
      const other = makeKeyPair();
      expect(verifyLegacyPayload(payload, email, fileHex, publish(other.publicKeyBase64))).toMatchObject({
        ok: false,
        reason: "unknown-key",
      });
    });

    it("rejects a legacy forgery that carries its own key", () => {
      const rogue = makeKeyPair();
      const payload = {
        signature: rogue.signHex(buildSignedMessage(fileHex, "ceo@gmail.com", t)),
        publicKey: rogue.publicKeyBase64,
        timestamp: t,
      };
      const trusted = makeKeyPair();
      const result = verifyLegacyPayload(payload, "ceo@gmail.com", fileHex, publish(trusted.publicKeyBase64));
      expect(result.ok).toBe(false);
    });
  });
});
