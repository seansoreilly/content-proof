import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/lib/rate-limit";

vi.mock("@/lib/redis", () => ({ getCounterStore: () => createMemoryStore() }));

const { jsonResponse, publicOptions, publicRoute } = await import("@/lib/public-route");

const request = (ip = "1.2.3.4"): Request => new Request("http://t/x", { headers: { "x-forwarded-for": ip } });

describe("jsonResponse", () => {
  it("adds CORS headers and any extra headers", async () => {
    const res = jsonResponse({ a: 1 }, 201, { "Cache-Control": "no-store" });
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ a: 1 });
  });
});

describe("publicOptions", () => {
  it("answers the preflight for the given methods", () => {
    const res = publicOptions(["GET"])();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});

describe("publicRoute", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes the arguments through to the handler", async () => {
    const handler = vi.fn(async (_req: Request, ctx: { id: string }) => jsonResponse({ id: ctx.id }, 200));
    const route = publicRoute({ failureStatus: 503, failureMessage: "Down", logTag: "[t]" }, handler);
    const res = await route(request(), { id: "x" });
    expect(await res.json()).toEqual({ id: "x" });
  });

  it("rate-limits by client IP with CORS headers on the 429", async () => {
    const route: (request: Request) => Promise<Response> = publicRoute(
      { limit: 2, prefix: "rl:t", failureStatus: 503, failureMessage: "Down", logTag: "[t]" },
      async () => jsonResponse({ ok: true }, 200)
    );
    expect((await route(request())).status).toBe(200);
    expect((await route(request())).status).toBe(200);
    const limited = await route(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-allow-origin")).toBe("*");
    expect(limited.headers.get("x-ratelimit-limit")).toBe("2");
    expect((await route(request("5.6.7.8"))).status).toBe(200);
  });

  it("turns a thrown error into the configured JSON failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const route = publicRoute(
      { failureStatus: 503, failureMessage: "Store unavailable", logTag: "[t] failed", logLevel: "warn" },
      async () => {
        throw new Error("boom");
      }
    );
    const res = await route();
    expect(res.status).toBe(503);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "Store unavailable" });
    expect(warn).toHaveBeenCalledWith("[t] failed", expect.any(Error));
  });

  it("requires a prefix when a limit is set", () => {
    expect(() =>
      publicRoute({ limit: 1, failureStatus: 500, failureMessage: "x", logTag: "[t]" }, async () => new Response())
    ).toThrow(/prefix/);
  });
});
