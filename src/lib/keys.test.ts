import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyPair, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64 } from "@/lib/keyset";
import { base64ToBytes, toBase64Url } from "@/lib/base64";

const rawOf = (spkiBase64: string): string => toBase64Url(base64ToBytes(spkiBase64).slice(-32));

async function loadKeys() {
  vi.resetModules();
  return import("@/lib/keys");
}

describe("server key management", () => {
  beforeEach(() => {
    vi.stubEnv("ED25519_PRIVATE_KEY", "");
    vi.stubEnv("ED25519_PUBLIC_KEY", "");
    vi.stubEnv("ED25519_PUBLIC_KEYS_PREVIOUS", "");
  });

  it("uses the configured key pair and publishes it under its derived id", async () => {
    const pair = stubServerKeys();
    const keys = await loadKeys();
    const { keyId } = keys.getSigningKeyPair();
    expect(keyId).toBe(keyIdFromSpkiBase64(pair.publicKeyBase64));
    const json = keys.buildPublicKeysJson();
    expect(json.current).toBe(keyId);
    expect(json.keys[keyId]).toEqual({
      keyId,
      algorithm: "Ed25519",
      publicKey: pair.publicKeyBase64,
    });
  });

  it("includes previous keys for verification but not as current", async () => {
    const current = stubServerKeys();
    const old = makeKeyPair();
    vi.stubEnv("ED25519_PUBLIC_KEYS_PREVIOUS", ` ${old.publicKeyBase64} , `);
    const keys = await loadKeys();
    const json = keys.buildPublicKeysJson();
    const oldId = keyIdFromSpkiBase64(old.publicKeyBase64);
    expect(json.current).toBe(keyIdFromSpkiBase64(current.publicKeyBase64));
    expect(Object.keys(json.keys)).toHaveLength(2);
    expect(json.keys[oldId]?.publicKey).toBe(old.publicKeyBase64);
  });

  it("refuses to sign in production when keys are missing, but only when called", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const keys = await loadKeys(); // import must not throw
    expect(() => keys.getSigningKeyPair()).toThrow(/ED25519/);
    expect(() => keys.buildPublicKeysJson()).toThrow(/ED25519/);
  });

  it("falls back to one memoised development key pair so sign and verify agree", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const keys = await loadKeys();
    const first = keys.getSigningKeyPair();
    const second = keys.getSigningKeyPair();
    expect(second.keyId).toBe(first.keyId);
    expect(keys.buildPublicKeysJson().current).toBe(first.keyId);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  describe("getServiceRawPublicKeys", () => {
    it("holds the base64url raw keys of the current and previous keys", async () => {
      const current = stubServerKeys();
      const old = makeKeyPair();
      vi.stubEnv("ED25519_PUBLIC_KEYS_PREVIOUS", ` ${old.publicKeyBase64} , `);
      const keys = await loadKeys();
      const raw = keys.getServiceRawPublicKeys();
      expect([...raw].sort()).toEqual([rawOf(current.publicKeyBase64), rawOf(old.publicKeyBase64)].sort());
      for (const key of raw) expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("agrees with the published public-keys document", async () => {
      stubServerKeys();
      vi.stubEnv("ED25519_PUBLIC_KEYS_PREVIOUS", makeKeyPair().publicKeyBase64);
      const keys = await loadKeys();
      const fromDocument = Object.values(keys.buildPublicKeysJson().keys).map((k) => rawOf(k.publicKey));
      expect(new Set(fromDocument)).toEqual(keys.getServiceRawPublicKeys());
    });

    it("memoises the set while the env is unchanged", async () => {
      stubServerKeys();
      const keys = await loadKeys();
      expect(keys.getServiceRawPublicKeys()).toBe(keys.getServiceRawPublicKeys());
    });

    it("recomputes when the current or previous keys change", async () => {
      const first = stubServerKeys();
      const keys = await loadKeys();
      const before = keys.getServiceRawPublicKeys();
      expect([...before]).toEqual([rawOf(first.publicKeyBase64)]);

      const old = makeKeyPair();
      vi.stubEnv("ED25519_PUBLIC_KEYS_PREVIOUS", old.publicKeyBase64);
      const withPrevious = keys.getServiceRawPublicKeys();
      expect(withPrevious).not.toBe(before);
      expect(withPrevious.has(rawOf(old.publicKeyBase64))).toBe(true);

      const rotated = stubServerKeys();
      const after = keys.getServiceRawPublicKeys();
      expect([...after]).toEqual([rawOf(rotated.publicKeyBase64)]);
    });

    it("uses the one development key pair when keys are not configured", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const keys = await loadKeys();
      const raw = keys.getServiceRawPublicKeys();
      expect([...raw]).toEqual([rawOf(keys.getSigningKeyPair().publicKeyBase64)]);
      expect(keys.getServiceRawPublicKeys()).toBe(raw);
    });

    it("throws, and caches nothing, in production without keys", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const keys = await loadKeys();
      expect(() => keys.getServiceRawPublicKeys()).toThrow(/ED25519/);
      const pair = stubServerKeys();
      expect([...keys.getServiceRawPublicKeys()]).toEqual([rawOf(pair.publicKeyBase64)]);
    });
  });
});
