import { describe, expect, it } from "vitest";
import { createMemoryStore, createRateLimiter, getClientIp } from "@/lib/rate-limit";

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
      incr: async () => {
        throw new Error("redis down");
      },
      expire: async () => 1,
    };
    const limit = createRateLimiter(broken, { limit: 1, windowSeconds: 1, prefix: "t" });
    expect((await limit("x")).allowed).toBe(true);
  });

  it("extracts the first forwarded IP", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("203.0.113.9");
    expect(getClientIp(new Request("http://x"))).toBe("unknown");
  });
});
