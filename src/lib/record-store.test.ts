import { describe, expect, it } from "vitest";
import type { Redis } from "@upstash/redis";
import {
  createMemoryRecordStore,
  createRedisRecordStore,
  InvalidCursorError,
  parseCursor,
  parseStoredRecord,
} from "@/lib/record-store";
import type { SignatureRecord } from "@/lib/record";

const record: SignatureRecord = {
  v: 2,
  k: "AbCdEfGhIjKlMnOp",
  h: "A".repeat(42) + "Q",
  e: "user@example.com",
  t: 1_760_000_000_000,
  s: "S".repeat(86),
};

describe("parseStoredRecord", () => {
  it("accepts a JSON string, as stored", () => {
    expect(parseStoredRecord(JSON.stringify(record))).toEqual(record);
  });

  it("accepts an object Upstash has already deserialised", () => {
    expect(parseStoredRecord({ ...record })).toEqual(record);
  });

  it("returns null for missing values", () => {
    expect(parseStoredRecord(null)).toBeNull();
    expect(parseStoredRecord(undefined)).toBeNull();
  });

  it("returns null instead of throwing on corrupt JSON", () => {
    expect(parseStoredRecord("{not json")).toBeNull();
    expect(parseStoredRecord("")).toBeNull();
  });

  it("returns null for well-formed JSON that is not a record", () => {
    expect(parseStoredRecord(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseStoredRecord("42")).toBeNull();
    expect(parseStoredRecord(42)).toBeNull();
    expect(parseStoredRecord({ ...record, v: 99 })).toBeNull();
  });
});

describe("memory record store", () => {
  it("stores records by signature and misses unknown signatures", async () => {
    const store = createMemoryRecordStore();
    expect(await store.get(record.s)).toBeNull();
    await store.put(record);
    expect(await store.get(record.s)).toEqual(record);
    expect(await store.get("Z".repeat(86))).toBeNull();
  });

  it("keeps separate instances independent", async () => {
    const a = createMemoryRecordStore();
    const b = createMemoryRecordStore();
    await a.put(record);
    expect(await b.get(record.s)).toBeNull();
  });
});

const sig = (n: number): string => n.toString(36).padStart(86, "A");
const rec = (n: number, t: number, e = "User@Example.com"): SignatureRecord => ({ ...record, e, t, s: sig(n) });

describe("memory record store: listing by email", () => {
  it("lists an account's records newest first, case-insensitively, and pages with a cursor", async () => {
    const store = createMemoryRecordStore();
    for (let i = 0; i < 5; i++) await store.put(rec(i, 1000 + i));
    await store.put(rec(9, 5000, "someone@else.com"));

    const first = await store.listByEmail("user@example.com", { limit: 2 });
    expect(first.records.map((r) => r.t)).toEqual([1004, 1003]);
    expect(first.nextCursor).toBe(`1003.${sig(3)}`);

    const second = await store.listByEmail("USER@example.com", { limit: 2, cursor: first.nextCursor! });
    expect(second.records.map((r) => r.t)).toEqual([1002, 1001]);
    const third = await store.listByEmail("user@example.com", { limit: 2, cursor: second.nextCursor! });
    expect(third.records.map((r) => r.t)).toEqual([1000]);
    expect(third.nextCursor).toBeNull();

    expect((await store.listByEmail("nobody@example.com", { limit: 5 })).records).toEqual([]);
  });

  it("breaks ties at the same millisecond by signature without repeating or skipping", async () => {
    const store = createMemoryRecordStore();
    for (let i = 0; i < 4; i++) await store.put(rec(i, 1000));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.listByEmail("user@example.com", { limit: 1, cursor });
      seen.push(...page.records.map((r) => r.s));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([sig(3), sig(2), sig(1), sig(0)]);
  });

  it("skips records whose TTL has run out", async () => {
    let now = 0;
    const store = createMemoryRecordStore(() => now);
    await store.put(rec(1, 1));
    now = 200 * 24 * 60 * 60 * 1000;
    await store.put(rec(2, 2));
    now = 366 * 24 * 60 * 60 * 1000;
    expect((await store.listByEmail("user@example.com", { limit: 5 })).records.map((r) => r.s)).toEqual([sig(2)]);
    expect(await store.get(sig(1))).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    const store = createMemoryRecordStore();
    for (const bad of ["", "abc", "1.short", `-1.${sig(1)}`, `01.${sig(1)}`]) {
      await expect(store.listByEmail("a@b.c", { limit: 1, cursor: bad })).rejects.toBeInstanceOf(InvalidCursorError);
    }
    expect(parseCursor(`12.${sig(1)}`)).toEqual({ t: 12, s: sig(1) });
  });
});

/**
 * Fake Upstash client covering the calls the record store makes. ZRANGE
 * honours BYSCORE REV LIMIT WITHSCORES with Redis's argument order (upper
 * bound first under REV) and returns the flat member/score array.
 */
function fakeRedis() {
  const strings = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const calls: string[] = [];
  const zadd = (key: string, { score, member }: { score: number; member: string }): void => {
    if (!zsets.has(key)) zsets.set(key, new Map());
    zsets.get(key)!.set(member, score);
  };
  const redis = {
    multi() {
      const ops: string[] = [];
      const run: Array<() => void> = [];
      const tx = {
        set(key: string, value: string) {
          ops.push(`set ${key}`);
          run.push(() => strings.set(key, value));
          return tx;
        },
        zadd(key: string, entry: { score: number; member: string }) {
          ops.push(`zadd ${key}`);
          run.push(() => zadd(key, entry));
          return tx;
        },
        expire(key: string) {
          ops.push(`expire ${key}`);
          return tx;
        },
        async exec() {
          calls.push(`exec [${ops.join(", ")}]`);
          run.forEach((op) => op());
          return [];
        },
      };
      return tx;
    },
    async zrange(
      key: string,
      max: number | string,
      min: number | string,
      opts: { byScore: boolean; rev: boolean; withScores: boolean; offset: number; count: number }
    ) {
      calls.push("zrange");
      expect(opts).toMatchObject({ byScore: true, rev: true, withScores: true });
      expect(min).toBe("-inf");
      const upper = max === "+inf" ? Infinity : Number(max);
      const sorted = [...(zsets.get(key) ?? new Map<string, number>()).entries()]
        .filter(([, score]) => score <= upper)
        .sort(([ma, sa], [mb, sb]) => sb - sa || (ma < mb ? 1 : ma > mb ? -1 : 0));
      return sorted.slice(opts.offset, opts.offset + opts.count).flatMap(([m, s]) => [m, String(s)]);
    },
    async mget(...keys: string[]) {
      calls.push("mget");
      // Upstash hands back JSON values already parsed.
      return keys.map((k) => (strings.has(k) ? (JSON.parse(strings.get(k)!) as unknown) : null));
    },
    async zrem(key: string, ...members: string[]) {
      calls.push(`zrem ${members.length}`);
      members.forEach((m) => zsets.get(key)?.delete(m));
      return members.length;
    },
    async get(key: string) {
      return strings.get(key) ?? null;
    },
  };
  return { redis: redis as unknown as Redis, strings, zsets, calls };
}

describe("Redis record store", () => {
  it("writes the record and its index entry in one transaction", async () => {
    const { redis, strings, zsets, calls } = fakeRedis();
    await createRedisRecordStore(redis).put(rec(1, 1234));
    const index = "sigs:email:user@example.com";
    expect(calls).toEqual([`exec [set sig:${sig(1)}, zadd ${index}, expire ${index}]`]);
    expect(strings.get(`sig:${sig(1)}`)).toBe(JSON.stringify(rec(1, 1234)));
    expect(zsets.get(index)?.get(sig(1))).toBe(1234);
  });

  it("lists newest first across batches, pages by cursor, and removes expired entries", async () => {
    const { redis, strings, zsets, calls } = fakeRedis();
    const store = createRedisRecordStore(redis);
    for (let i = 0; i < 120; i++) await store.put(rec(i, 10_000 + i));
    // Expire every third record, as Redis would when its TTL runs out.
    for (let i = 0; i < 120; i += 3) strings.delete(`sig:${sig(i)}`);

    const listed: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.listByEmail("USER@example.com", { limit: 30, cursor });
      listed.push(...page.records.map((r) => r.t - 10_000));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const expected = Array.from({ length: 120 }, (_, i) => 119 - i).filter((i) => i % 3 !== 0);
    expect(listed).toEqual(expected);
    expect(zsets.get("sigs:email:user@example.com")?.size).toBe(80);
    expect(calls.some((c) => c.startsWith("zrem"))).toBe(true);
  });

  it("pages through ties at the same millisecond one at a time", async () => {
    const { redis } = fakeRedis();
    const store = createRedisRecordStore(redis);
    for (let i = 0; i < 4; i++) await store.put(rec(i, 1000));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.listByEmail("user@example.com", { limit: 1, cursor });
      seen.push(...page.records.map((r) => r.s));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([sig(3), sig(2), sig(1), sig(0)]);
  });

  it("returns an empty page for an unknown account without calling MGET", async () => {
    const { redis, calls } = fakeRedis();
    expect(await createRedisRecordStore(redis).listByEmail("x@y.z", { limit: 5 })).toEqual({ records: [], nextCursor: null });
    expect(calls).not.toContain("mget");
  });
});
