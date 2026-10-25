import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyPair, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64 } from "@/lib/keyset";

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
});
