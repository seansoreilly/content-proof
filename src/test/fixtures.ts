import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { vi } from "vitest";

export interface TestKeyPair {
  privateKeyBase64: string;
  publicKeyBase64: string;
  signHex: (message: string) => string;
}

/** Generate a fresh Ed25519 key pair encoded the way the app's env vars expect. */
export function makeKeyPair(): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyBase64: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    publicKeyBase64: publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
    signHex: (message: string) =>
      sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64url"),
  };
}

/** Point the server at a known key pair for the duration of a test. */
export function stubServerKeys(pair: TestKeyPair = makeKeyPair()): TestKeyPair {
  vi.stubEnv("ED25519_PRIVATE_KEY", pair.privateKeyBase64);
  vi.stubEnv("ED25519_PUBLIC_KEY", pair.publicKeyBase64);
  vi.stubEnv("ED25519_PUBLIC_KEYS_PREVIOUS", "");
  return pair;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function jsonRequest(url: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
}
