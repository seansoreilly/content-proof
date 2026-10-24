import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyPair, sha256Hex, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64, type PublicKeysJson } from "@/lib/keyset";
import { verifyEd25519Raw, verifyRecord } from "@/lib/crypto/verify";
import {
  RECORD_VERSION_USER_SIGNED,
  buildSignedMessage,
  createVerificationUrl,
  decodeRecord,
  encodeRecord,
  parseRecordObject,
} from "@/lib/record";
import { generateUserKeyPair, toUserSigningKey, userKeysSupported } from "@/lib/user-keys";

function publish(spki: string): PublicKeysJson {
  const keyId = keyIdFromSpkiBase64(spki);
  return { current: keyId, keys: { [keyId]: { keyId, algorithm: "Ed25519", publicKey: spki } } };
}

describe("account holder keys (WebCrypto Ed25519)", () => {
  const email = "holder@example.com";
  const fileHex = sha256Hex("the file");

  beforeEach(() => vi.resetModules());

  it("generates a non-extractable key whose signatures verify with the raw public key", async () => {
    expect(userKeysSupported()).toBe(true);
    const pair = await generateUserKeyPair();
    expect(pair.privateKey.extractable).toBe(false);
    const key = await toUserSigningKey(pair);
    expect(key.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sig = await key.sign("hello");
    expect(verifyEd25519Raw("hello", sig, key.publicKey)).toBe(true);
    expect(verifyEd25519Raw("hullo", sig, key.publicKey)).toBe(false);
  });

  it("the service countersigns a user-signed statement into a v3 record that fully verifies", async () => {
    const service = stubServerKeys();
    const { signFileHash } = await import("@/lib/crypto/ed25519");
    const key = await toUserSigningKey(await generateUserKeyPair());
    const t = 1_760_000_000_000;
    const us = await key.sign(buildSignedMessage(fileHex, email, t));

    const record = signFileHash(fileHex, email, t, { publicKey: key.publicKey, signature: us });
    expect(record.v).toBe(RECORD_VERSION_USER_SIGNED);
    expect(record.u).toBe(key.publicKey);
    expect(record.us).toBe(us);

    const keys = publish(service.publicKeyBase64);
    expect(verifyRecord(record, fileHex, keys)).toEqual({
      ok: true,
      keyId: record.k,
      userSigned: true,
      userKey: key.publicKey,
    });

    // Codec round trip and QR budget for the longer record
    expect(decodeRecord(encodeRecord(record))).toEqual(record);
    expect(parseRecordObject(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(createVerificationUrl(encodeRecord(record), "https://contentproof.app").length).toBeLessThan(400);
  });

  it("rejects tampering with either signature or the user key", async () => {
    const service = stubServerKeys();
    const { signFileHash } = await import("@/lib/crypto/ed25519");
    const key = await toUserSigningKey(await generateUserKeyPair());
    const t = 1_760_000_000_000;
    const us = await key.sign(buildSignedMessage(fileHex, email, t));
    const record = signFileHash(fileHex, email, t, { publicKey: key.publicKey, signature: us });
    const keys = publish(service.publicKeyBase64);

    // Swap in another user's key: the service countersignature no longer matches
    const other = await toUserSigningKey(await generateUserKeyPair());
    expect(verifyRecord({ ...record, u: other.publicKey }, fileHex, keys)).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
    // Swap the user signature for another valid-looking one: same
    const otherSig = await other.sign(buildSignedMessage(fileHex, email, t));
    expect(verifyRecord({ ...record, us: otherSig }, fileHex, keys)).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
    // Strip the user fields: a v3 record without them is malformed at parse time
    expect(parseRecordObject({ ...record, u: undefined, us: undefined })).toBeNull();
    // A v2 record must not smuggle user fields
    expect(parseRecordObject({ ...record, v: 2 })).toBeNull();
  });

  it("the service refuses to countersign a user signature that does not verify", async () => {
    stubServerKeys();
    const { signFileHash, InvalidUserSignatureError } = await import("@/lib/crypto/ed25519");
    const key = await toUserSigningKey(await generateUserKeyPair());
    const t = 1_760_000_000_000;
    const wrong = await key.sign(buildSignedMessage(fileHex, "someone-else@example.com", t));
    expect(() => signFileHash(fileHex, email, t, { publicKey: key.publicKey, signature: wrong })).toThrow(
      InvalidUserSignatureError
    );
    expect(() => signFileHash(fileHex, email, t, { publicKey: "nope", signature: wrong })).toThrow(
      InvalidUserSignatureError
    );
  });

  it("a forger with their own service key still fails on the published-key check", async () => {
    const rogueService = makeKeyPair();
    const key = await toUserSigningKey(await generateUserKeyPair());
    const t = Date.now();
    const us = await key.sign(buildSignedMessage(fileHex, "ceo@gmail.com", t));
    const forged = {
      v: RECORD_VERSION_USER_SIGNED,
      k: keyIdFromSpkiBase64(rogueService.publicKeyBase64),
      h: "x".repeat(43),
      e: "ceo@gmail.com",
      t,
      s: rogueService.signHex("whatever"),
      u: key.publicKey,
      us,
    };
    const trusted = makeKeyPair();
    expect(verifyRecord(forged, fileHex, publish(trusted.publicKeyBase64))).toMatchObject({
      ok: false,
      reason: "unknown-key",
    });
  });
});
