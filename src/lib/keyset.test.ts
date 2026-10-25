import { describe, expect, it } from "vitest";
import {
  findPublicKey,
  isKnownPublicKey,
  keyIdFromSpkiBase64,
  parsePublicKeysJson,
  type PublicKeysJson,
} from "@/lib/keyset";
import { makeKeyPair } from "@/test/fixtures";

describe("keyset (browser-safe helpers)", () => {
  const a = makeKeyPair();
  const b = makeKeyPair();
  const keys: PublicKeysJson = {
    current: keyIdFromSpkiBase64(a.publicKeyBase64),
    keys: {
      [keyIdFromSpkiBase64(a.publicKeyBase64)]: {
        keyId: keyIdFromSpkiBase64(a.publicKeyBase64),
        algorithm: "Ed25519",
        publicKey: a.publicKeyBase64,
      },
    },
  };

  it("derives a stable 16-char URL-safe key id from the public key", () => {
    const id = keyIdFromSpkiBase64(a.publicKeyBase64);
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(keyIdFromSpkiBase64(a.publicKeyBase64)).toBe(id);
    expect(keyIdFromSpkiBase64(b.publicKeyBase64)).not.toBe(id);
  });

  it("finds a published key by id and nothing else", () => {
    expect(findPublicKey(keys, keys.current)?.publicKey).toBe(a.publicKeyBase64);
    expect(findPublicKey(keys, keyIdFromSpkiBase64(b.publicKeyBase64))).toBeUndefined();
    expect(findPublicKey(keys, "")).toBeUndefined();
  });

  it("recognises a raw public key only when it is published", () => {
    expect(isKnownPublicKey(keys, a.publicKeyBase64)).toBe(true);
    expect(isKnownPublicKey(keys, b.publicKeyBase64)).toBe(false);
  });
});

describe("parsePublicKeysJson", () => {
  const a = makeKeyPair();
  const id = keyIdFromSpkiBase64(a.publicKeyBase64);
  const entry = { keyId: id, algorithm: "Ed25519", publicKey: a.publicKeyBase64 };

  it("accepts a consistent document", () => {
    expect(parsePublicKeysJson({ current: id, keys: { [id]: entry } })?.current).toBe(id);
  });

  it("rejects an empty key set", () => {
    expect(parsePublicKeysJson({ current: id, keys: {} })).toBeNull();
  });

  it("rejects a current id that is not among the keys", () => {
    expect(parsePublicKeysJson({ current: "nope", keys: { [id]: entry } })).toBeNull();
    expect(parsePublicKeysJson({ current: "toString", keys: { [id]: entry } })).toBeNull();
  });
});
