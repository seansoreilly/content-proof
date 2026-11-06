import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyPair, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64 } from "@/lib/keyset";
import { createMemoryStore } from "@/lib/rate-limit";
import { createMemoryLogStore, type LogStore } from "@/lib/log-store";
import type { SignatureRecord } from "@/lib/record";

const state: { log: LogStore; durable: boolean } = { log: createMemoryLogStore(), durable: false };

vi.mock("@/lib/redis", () => ({
  getCounterStore: () => createMemoryStore(),
  getLogStore: () => state.log,
  storageStatus: () => (state.durable ? { durable: true, backend: "redis" } : { durable: false, backend: "memory" }),
}));

async function route() {
  vi.resetModules();
  return import("@/app/api/health/route");
}

const get = (ip = "203.0.113.1"): Request =>
  new Request("http://t/api/health", { headers: { "x-forwarded-for": ip } });

function rec(i: number): SignatureRecord {
  return { v: 2, k: "AbCdEfGhIjKlMnOp", h: "A".repeat(42) + "Q", e: "u@example.com", t: i, s: String(i).repeat(86) };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    state.log = createMemoryLogStore();
    state.durable = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports storage, log size and the signing key id with CORS and no-store", async () => {
    const pair = stubServerKeys(makeKeyPair());
    await state.log.append(rec(1));
    await state.log.append(rec(2));
    const { GET } = await route();

    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      ok: true,
      storage: { durable: false, backend: "memory" },
      log: { size: 2 },
      keyId: keyIdFromSpkiBase64(pair.publicKeyBase64),
    });
  });

  it("reports durable Redis storage", async () => {
    stubServerKeys();
    state.durable = true;
    const { GET } = await route();
    const body = (await (await GET(get())).json()) as { storage: unknown };
    expect(body.storage).toEqual({ durable: true, backend: "redis" });
  });

  it("answers 200 with a null key id when production keys are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ED25519_PRIVATE_KEY", "");
    vi.stubEnv("ED25519_PUBLIC_KEY", "");
    const { GET } = await route();
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { keyId: unknown }).keyId).toBeNull();
  });

  it("answers 200 with the log marked unavailable when the size cannot be read", async () => {
    stubServerKeys();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.log = {
      ...createMemoryLogStore(),
      size: async () => {
        throw new Error("redis down");
      },
    };
    const { GET } = await route();
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; log: unknown };
    expect(body.ok).toBe(true);
    expect(body.log).toEqual({ size: null, error: "unavailable" });
  });

  it("rate-limits by client IP at 60 per minute", async () => {
    stubServerKeys();
    const { GET } = await route();
    for (let i = 0; i < 60; i++) expect((await GET(get("198.51.100.7"))).status).toBe(200);
    const limited = await GET(get("198.51.100.7"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-allow-origin")).toBe("*");
    expect((await GET(get("198.51.100.8"))).status).toBe(200);
  });

  it("answers the CORS preflight", async () => {
    const { OPTIONS } = await route();
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});
