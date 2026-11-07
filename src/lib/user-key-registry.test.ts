import { describe, expect, it } from "vitest";
import type { Redis } from "@upstash/redis";
import {
  createMemoryUserKeyRegistry,
  createRedisUserKeyRegistry,
  isCorruptKeyEntryError,
  parseUserKeyEntry,
  parseUserKeyOwner,
  REVOKE_SCRIPT,
  TOUCH_SCRIPT,
} from "@/lib/user-key-registry";

const KEY_A = "A".repeat(43);
const KEY_B = "B".repeat(43);

describe("memory user key registry", () => {
  it("records first and last use and lists keys most recently used first", async () => {
    const registry = createMemoryUserKeyRegistry();
    expect(await registry.lookup(KEY_A)).toBeNull();
    expect(await registry.touch("User@Example.com", KEY_A, 100)).toBe("recorded");
    expect(await registry.touch("user@example.com", KEY_A, 300)).toBe("recorded");
    expect(await registry.touch("user@example.com", KEY_A, 200)).toBe("recorded"); // never moves lastSeen back
    expect(await registry.touch("user@example.com", KEY_B, 250)).toBe("recorded");

    expect(await registry.list("USER@example.com")).toEqual([
      { publicKey: KEY_A, firstSeen: 100, lastSeen: 300 },
      { publicKey: KEY_B, firstSeen: 250, lastSeen: 250 },
    ]);
    expect(await registry.lookup(KEY_A)).toEqual({ email: "user@example.com" });
    expect(await registry.list("other@example.com")).toEqual([]);
  });

  it("pins a key to the first account that used it", async () => {
    const registry = createMemoryUserKeyRegistry();
    await registry.touch("a@example.com", KEY_A, 1);
    expect(await registry.touch("b@example.com", KEY_A, 2)).toBe("other-account");
    expect(await registry.list("b@example.com")).toEqual([]);
    expect(await registry.lookup(KEY_A)).toEqual({ email: "a@example.com" });
  });

  it("revokes permanently, only for the owning account, and never un-revokes on touch", async () => {
    const registry = createMemoryUserKeyRegistry();
    await registry.touch("a@example.com", KEY_A, 1);
    expect(await registry.revoke("b@example.com", KEY_A, 5)).toBeNull();
    expect(await registry.revoke("a@example.com", KEY_B, 5)).toBeNull();

    expect(await registry.revoke("A@example.com", KEY_A, 10)).toEqual({ publicKey: KEY_A, firstSeen: 1, lastSeen: 1, revokedAt: 10 });
    expect(await registry.revoke("a@example.com", KEY_A, 20)).toMatchObject({ revokedAt: 10 });
    expect(await registry.lookup(KEY_A)).toEqual({ email: "a@example.com", revokedAt: 10 });

    expect(await registry.touch("a@example.com", KEY_A, 30)).toBe("revoked");
    expect(await registry.list("a@example.com")).toEqual([{ publicKey: KEY_A, firstSeen: 1, lastSeen: 1, revokedAt: 10 }]);
  });
});

describe("stored entry parsing", () => {
  it("accepts JSON strings and pre-parsed objects and rejects corrupt values", () => {
    const entry = { publicKey: KEY_A, firstSeen: 1, lastSeen: 2 };
    expect(parseUserKeyEntry(JSON.stringify(entry))).toEqual(entry);
    expect(parseUserKeyEntry({ ...entry, revokedAt: 3 })).toEqual({ ...entry, revokedAt: 3 });
    expect(parseUserKeyEntry("{nope")).toBeNull();
    expect(parseUserKeyEntry({ ...entry, firstSeen: "1" })).toBeNull();
    expect(parseUserKeyEntry({ ...entry, revokedAt: "x" })).toBeNull();
    expect(parseUserKeyOwner('{"email":"a@b.c","revokedAt":4}')).toEqual({ email: "a@b.c", revokedAt: 4 });
    expect(parseUserKeyOwner({ email: "a@b.c" })).toEqual({ email: "a@b.c" });
    expect(parseUserKeyOwner({ nope: 1 })).toBeNull();
  });
});

describe("Redis user key registry", () => {
  function fake(results: Record<string, unknown> = {}) {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const redis = {
      async eval(script: string, keys: string[], args: string[]) {
        calls.push({ method: "eval", args: [script, keys, args] });
        return script === TOUCH_SCRIPT ? (results.touch ?? "recorded") : (results.revoke ?? null);
      },
      async get(key: string) {
        calls.push({ method: "get", args: [key] });
        return results.get ?? null;
      },
      async hgetall(key: string) {
        calls.push({ method: "hgetall", args: [key] });
        return results.hgetall ?? null;
      },
    };
    return { redis: redis as unknown as Redis, calls };
  }

  it("touches through one script with lowercased account keys", async () => {
    const { redis, calls } = fake();
    expect(await createRedisUserKeyRegistry(redis).touch("User@Example.com", KEY_A, 123)).toBe("recorded");
    expect(calls).toEqual([
      { method: "eval", args: [TOUCH_SCRIPT, ["ukeys:user@example.com", `ukey:${KEY_A}`], ["user@example.com", KEY_A, "123"]] },
    ]);
    const other = fake({ touch: "other-account" });
    expect(await createRedisUserKeyRegistry(other.redis).touch("a@b.c", KEY_A, 1)).toBe("other-account");
    await expect(createRedisUserKeyRegistry(fake({ touch: "weird" }).redis).touch("a@b.c", KEY_A, 1)).rejects.toThrow();
  });

  it("revokes through one script and parses the entry it returns", async () => {
    const entry = { publicKey: KEY_A, firstSeen: 1, lastSeen: 2, revokedAt: 3 };
    const { redis, calls } = fake({ revoke: entry });
    expect(await createRedisUserKeyRegistry(redis).revoke("A@b.c", KEY_A, 3)).toEqual(entry);
    expect(calls[0].args).toEqual([REVOKE_SCRIPT, ["ukeys:a@b.c", `ukey:${KEY_A}`], ["a@b.c", KEY_A, "3"]]);
    expect(await createRedisUserKeyRegistry(fake().redis).revoke("a@b.c", KEY_A, 3)).toBeNull();
  });

  it("looks up owners, treating a corrupt owner entry as an error rather than unknown", async () => {
    expect(await createRedisUserKeyRegistry(fake().redis).lookup(KEY_A)).toBeNull();
    expect(await createRedisUserKeyRegistry(fake({ get: { email: "a@b.c", revokedAt: 9 } }).redis).lookup(KEY_A)).toEqual({
      email: "a@b.c",
      revokedAt: 9,
    });
    await expect(createRedisUserKeyRegistry(fake({ get: "garbage" }).redis).lookup(KEY_A)).rejects.toSatisfy(isCorruptKeyEntryError);
  });

  it("lists entries most recently used first and drops corrupt ones", async () => {
    const hgetall = {
      [KEY_A]: { publicKey: KEY_A, firstSeen: 1, lastSeen: 5 },
      [KEY_B]: JSON.stringify({ publicKey: KEY_B, firstSeen: 2, lastSeen: 9 }),
      bad: "nope",
    };
    expect((await createRedisUserKeyRegistry(fake({ hgetall }).redis).list("a@b.c")).map((e) => e.publicKey)).toEqual([KEY_B, KEY_A]);
    expect(await createRedisUserKeyRegistry(fake().redis).list("a@b.c")).toEqual([]);
  });
});
