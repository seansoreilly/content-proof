import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REDIS_ENV = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"];

async function load() {
  vi.resetModules();
  return import("@/lib/redis");
}

describe("storage status", () => {
  beforeEach(() => {
    for (const name of REDIS_ENV) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports the memory fallback as not durable", async () => {
    const { storageStatus } = await load();
    expect(storageStatus()).toEqual({ durable: false, backend: "memory" });
  });

  it("reports Redis as durable when configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const { storageStatus } = await load();
    expect(storageStatus()).toEqual({ durable: true, backend: "redis" });
  });

  it("logs one loud error in production on the memory fallback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getCounterStore, getLogStore, getRecordStore, storageStatus } = await load();
    getCounterStore();
    expect(error).not.toHaveBeenCalled();
    getLogStore();
    getRecordStore();
    storageStatus();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/WILL NOT PERSIST/);
  });

  it("stays quiet outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getLogStore, storageStatus } = await load();
    getLogStore();
    storageStatus();
    expect(error).not.toHaveBeenCalled();
  });
});
