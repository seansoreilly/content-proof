import { describe, expect, it, vi } from "vitest";
import { fetchUserKeyStatus, parseUserKeyStatus } from "@/lib/user-key-status";

const KEY = "A".repeat(43);

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchUserKeyStatus", () => {
  it("fetches and validates the status of a key", async () => {
    const fetchImpl = vi.fn(async () => respond({ publicKey: KEY, known: true, revokedAt: 1234 }));
    expect(await fetchUserKeyStatus(KEY, fetchImpl as typeof fetch)).toEqual({ publicKey: KEY, known: true, revokedAt: 1234 });
    expect(fetchImpl).toHaveBeenCalledWith(`/api/keys/user/${KEY}`, { cache: "no-store" });
  });

  it("reports a known, unrevoked key and an unknown key", async () => {
    const known = vi.fn(async () => respond({ publicKey: KEY, known: true, revokedAt: null }));
    expect(await fetchUserKeyStatus(KEY, known as typeof fetch)).toEqual({ publicKey: KEY, known: true, revokedAt: null });
    const unknown = vi.fn(async () => respond({ publicKey: KEY, known: false, revokedAt: null }));
    expect(await fetchUserKeyStatus(KEY, unknown as typeof fetch)).toMatchObject({ known: false });
  });

  it("resolves to null instead of throwing when the status cannot be had", async () => {
    const never = vi.fn();
    expect(await fetchUserKeyStatus("not-a-key", never as unknown as typeof fetch)).toBeNull();
    expect(never).not.toHaveBeenCalled();

    const cases: Array<() => Promise<Response>> = [
      async () => respond({ error: "Too many requests" }, 429),
      async () => respond({ error: "down" }, 503),
      async () => new Response("<html>", { status: 200 }),
      async () => {
        throw new TypeError("offline");
      },
    ];
    for (const impl of cases) expect(await fetchUserKeyStatus(KEY, vi.fn(impl) as typeof fetch)).toBeNull();
  });
});

describe("parseUserKeyStatus", () => {
  it("rejects bodies about another key or with the wrong types", () => {
    expect(parseUserKeyStatus({ publicKey: "B".repeat(43), known: true, revokedAt: null }, KEY)).toBeNull();
    expect(parseUserKeyStatus({ publicKey: KEY, known: "yes", revokedAt: null }, KEY)).toBeNull();
    expect(parseUserKeyStatus({ publicKey: KEY, known: true, revokedAt: "1" }, KEY)).toBeNull();
    expect(parseUserKeyStatus({ publicKey: KEY, known: true }, KEY)).toBeNull();
    expect(parseUserKeyStatus(null, KEY)).toBeNull();
  });
});
