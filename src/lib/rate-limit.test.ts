import { describe, expect, it } from "vitest";
import type { Redis } from "@upstash/redis";
import {
  createMemoryStore,
  createRateLimiter,
  createRedisCounterStore,
  getClientIp,
  INCR_WITH_EXPIRY_SCRIPT,
  rateLimitedResponse,
} from "@/lib/rate-limit";

/**
 * Fake Redis that records every call and runs the counter script against an
 * in-memory map with TTLs, so tests see what the real script would do.
 */
function fakeRedis(now: () => number) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const values = new Map<string, { value: number; expiresAt: number | null }>();
  const live = (key: string) => {
    const entry = values.get(key);
    if (entry && entry.expiresAt !== null && now() >= entry.expiresAt) values.delete(key);
    return values.get(key);
  };
  const redis = {
    async eval(script: string, keys: string[], args: unknown[]) {
      calls.push({ method: "eval", args: [script, keys, args] });
      if (script !== INCR_WITH_EXPIRY_SCRIPT) throw new Error("unexpected script");
      const [key] = keys;
      const entry = live(key) ?? { value: 0, expiresAt: null };
      entry.value += 1;
      if (entry.expiresAt === null) entry.expiresAt = now() + Number(args[0]) * 1000;
      values.set(key, entry);
      return entry.value;
    },
  };
  return { redis: redis as unknown as Redis, calls, values };
}

describe("rate limiter", () => {
  it("allows up to the limit in a window and blocks the next request", async () => {
    let now = 1_000_000;
    const store = createMemoryStore(() => now);
    const limit = createRateLimiter(store, { limit: 3, windowSeconds: 60, prefix: "t" });

    expect(await limit("alice")).toEqual({ allowed: true, remaining: 2 });
    expect(await limit("alice")).toEqual({ allowed: true, remaining: 1 });
    expect(await limit("alice")).toEqual({ allowed: true, remaining: 0 });
    expect(await limit("alice")).toEqual({ allowed: false, remaining: 0 });
    // other keys are independent
    expect((await limit("bob")).allowed).toBe(true);

    now += 61_000;
    expect(await limit("alice")).toEqual({ allowed: true, remaining: 2 });
  });

  it("fails open if the store throws so a cache outage never blocks signing", async () => {
    const broken = {
      incrWithExpiry: async (): Promise<number> => {
        throw new Error("redis down");
      },
    };
    const limit = createRateLimiter(broken, { limit: 1, windowSeconds: 1, prefix: "t" });
    expect((await limit("x")).allowed).toBe(true);
  });

  it("starts the window on the first request of a key", async () => {
    let now = 0;
    const store = createMemoryStore(() => now);
    expect(await store.incrWithExpiry("k", 10)).toBe(1);
    now = 9_999;
    expect(await store.incrWithExpiry("k", 10)).toBe(2);
    now = 10_000;
    expect(await store.incrWithExpiry("k", 10)).toBe(1);
  });

  it("increments and sets the expiry in one Redis round trip", async () => {
    let now = 0;
    const { redis, calls, values } = fakeRedis(() => now);
    const limit = createRateLimiter(createRedisCounterStore(redis), { limit: 2, windowSeconds: 60, prefix: "rl" });

    expect(await limit("1.2.3.4")).toEqual({ allowed: true, remaining: 1 });
    expect(await limit("1.2.3.4")).toEqual({ allowed: true, remaining: 0 });
    expect(await limit("1.2.3.4")).toEqual({ allowed: false, remaining: 0 });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.method === "eval")).toBe(true);
    expect(calls[0].args).toEqual([INCR_WITH_EXPIRY_SCRIPT, ["rl:1.2.3.4"], ["60"]]);
    expect(values.get("rl:1.2.3.4")?.expiresAt).toBe(60_000);

    now = 60_000;
    expect(await limit("1.2.3.4")).toEqual({ allowed: true, remaining: 1 });
  });

  it("accepts a count Redis returns as a string", async () => {
    const redis = { eval: async () => "7" } as unknown as Redis;
    expect(await createRedisCounterStore(redis).incrWithExpiry("k", 1)).toBe(7);
  });

  it("fails open when the Redis script errors", async () => {
    const redis = {
      eval: async () => {
        throw new Error("NOSCRIPT");
      },
    } as unknown as Redis;
    const limit = createRateLimiter(createRedisCounterStore(redis), { limit: 1, windowSeconds: 1, prefix: "t" });
    expect(await limit("x")).toEqual({ allowed: true, remaining: 1 });
  });

  it("builds a 429 with retry and rate-limit headers and a generic body", async () => {
    const res = rateLimitedResponse({ allowed: false, remaining: 0 }, 30, { "Access-Control-Allow-Origin": "*" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("x-ratelimit-limit")).toBe("30");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "Too many requests" });
  });

  it("extracts the first forwarded IP", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("203.0.113.9");
    expect(getClientIp(new Request("http://x"))).toBe("unknown");
  });
});
