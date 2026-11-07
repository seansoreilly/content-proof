import { describe, expect, it } from "vitest";
import type { Redis } from "@upstash/redis";
import { APPEND_SCRIPT, BACKFILL_SCRIPT, createRedisLogStore } from "@/lib/log-store";
import { recordLeafHash } from "@/lib/log-verify";
import { bytesToHex } from "@/lib/base64";
import type { SignatureRecord } from "@/lib/record";

function rec(i: number): SignatureRecord {
  return {
    v: 2,
    k: "AbCdEfGhIjKlMnOp",
    h: "A".repeat(42) + "Q",
    e: `user${i}@example.com`,
    t: 1_760_000_000_000 + i,
    s: String.fromCharCode(65 + (i % 26)).repeat(86),
  };
}

/**
 * Fake Upstash client that records calls and runs the append script against
 * in-memory lists and strings. `failEval` simulates the script failing as a
 * whole, which is what atomicity guarantees: no partial write.
 */
function fakeRedis() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const lists = new Map<string, string[]>();
  const strings = new Map<string, string>();
  const state = { failEval: false };
  const redis = {
    async eval(script: string, keys: string[], args: unknown[]) {
      calls.push({ method: "eval", args: [script, keys, args] });
      if (state.failEval) throw new Error("connection reset");
      const list = (key: string): string[] => {
        if (!lists.has(key)) lists.set(key, []);
        return lists.get(key)!;
      };
      if (script === APPEND_SCRIPT) {
        const length = list(keys[0]).push(String(args[0]));
        strings.set(keys[1], String(length - 1));
        if (list(keys[2]).length === length - 1) list(keys[2]).push(String(args[1]));
        return length;
      }
      if (script === BACKFILL_SCRIPT) {
        const start = Number(args[0]);
        const hashes = args.slice(1).map(String);
        if (list(keys[0]).length !== start) return 0;
        if (list(keys[1]).length < start + hashes.length) return 0;
        list(keys[0]).push(...hashes);
        return hashes.length;
      }
      throw new Error("unexpected script");
    },
    async llen(key: string) {
      calls.push({ method: "llen", args: [key] });
      return lists.get(key)?.length ?? 0;
    },
    async lindex(key: string, index: number) {
      calls.push({ method: "lindex", args: [key, index] });
      return lists.get(key)?.[index] ?? null;
    },
    async lrange(key: string, start: number, stop: number) {
      calls.push({ method: "lrange", args: [key, start, stop] });
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },
    async get(key: string) {
      calls.push({ method: "get", args: [key] });
      // Upstash auto-deserialises numeric strings.
      const raw = strings.get(key);
      return raw === undefined ? null : Number(raw);
    },
  };
  return { redis: redis as unknown as Redis, calls, lists, strings, state };
}

describe("Redis log store", () => {
  it("appends the entry, its signature index and its leaf hash in a single script call", async () => {
    const { redis, calls, strings, lists } = fakeRedis();
    const log = createRedisLogStore(redis);

    expect(await log.append(rec(0))).toBe(0);
    expect(await log.append(rec(1))).toBe(1);

    expect(calls.map((c) => c.method)).toEqual(["eval", "eval"]);
    expect(calls[1].args).toEqual([
      APPEND_SCRIPT,
      ["log:records", `logidx:${rec(1).s}`, "log:leaves"],
      [JSON.stringify(rec(1)), quotedLeaf(1)],
    ]);
    expect(strings.get(`logidx:${rec(1).s}`)).toBe("1");
    expect(lists.get("log:leaves")).toEqual([quotedLeaf(0), quotedLeaf(1)]);
    expect((await log.leafHashes(0, 5)).map(bytesToHex)).toEqual([leafHex(0), leafHex(1)]);

    expect(await log.size()).toBe(2);
    expect(await log.get(1)).toEqual(rec(1));
    expect(await log.range(0, 5)).toEqual([rec(0), rec(1)]);
    expect(await log.indexOf(rec(1).s)).toBe(1);
  });

  it("leaves neither the entry nor the index behind when the write fails", async () => {
    const { redis, lists, strings, state } = fakeRedis();
    const log = createRedisLogStore(redis);
    state.failEval = true;
    await expect(log.append(rec(0))).rejects.toThrow("connection reset");
    expect(lists.size).toBe(0);
    expect(strings.size).toBe(0);
  });

  it("derives the index from a length Redis returns as a string", async () => {
    const redis = { eval: async () => "5" } as unknown as Redis;
    expect(await createRedisLogStore(redis).append(rec(0))).toBe(4);
  });

  it("fails loudly on a corrupt entry rather than shifting later indexes", async () => {
    const { redis, lists } = fakeRedis();
    lists.set("log:records", [JSON.stringify(rec(0)), "{corrupt", JSON.stringify({ not: "a record" })]);
    const log = createRedisLogStore(redis);
    expect(await log.get(0)).toEqual(rec(0));
    expect(await log.get(3)).toBeNull();
    await expect(log.range(0, 3)).rejects.toThrow("index 1");
    await expect(log.get(1)).rejects.toThrow("index 1");
    await expect(log.get(2)).rejects.toThrow("index 2");
  });
});

const leafHex = (i: number): string => bytesToHex(recordLeafHash(rec(i)));
const quotedLeaf = (i: number): string => JSON.stringify(leafHex(i));

describe("Redis log leaf hashes", () => {
  /** A log written by a version that stored no leaf hashes. */
  function legacyLog(count: number) {
    const fake = fakeRedis();
    fake.lists.set(
      "log:records",
      Array.from({ length: count }, (_, i) => JSON.stringify(rec(i)))
    );
    return { ...fake, log: createRedisLogStore(fake.redis) };
  }

  it("backfills missing leaf hashes from the records, once", async () => {
    const { log, lists, calls } = legacyLog(4);
    expect((await log.leafHashes(0, 4)).map(bytesToHex)).toEqual([0, 1, 2, 3].map(leafHex));
    expect(lists.get("log:leaves")).toEqual([0, 1, 2, 3].map(quotedLeaf));
    expect(calls.filter((c) => c.method === "eval")).toHaveLength(1);

    // Second read is served from the leaf list alone.
    calls.length = 0;
    expect((await log.leafHashes(1, 2)).map(bytesToHex)).toEqual([leafHex(1), leafHex(2)]);
    expect(calls.map((c) => c.method)).toEqual(["lrange"]);
  });

  it("does not push a new leaf onto a lagging list, and catches up on the next read", async () => {
    const { log, lists } = legacyLog(3);
    expect(await log.append(rec(3))).toBe(3);
    // Pushing now would have put entry 3's hash at index 0.
    expect(lists.get("log:leaves") ?? []).toEqual([]);
    expect((await log.leafHashes(0, 10)).map(bytesToHex)).toEqual([0, 1, 2, 3].map(leafHex));
    expect(await log.append(rec(4))).toBe(4);
    expect(lists.get("log:leaves")).toEqual([0, 1, 2, 3, 4].map(quotedLeaf));
  });

  it("never duplicates hashes when two readers backfill the same range", async () => {
    const { redis, lists } = legacyLog(3);
    const a = createRedisLogStore(redis);
    const b = createRedisLogStore(redis);
    const [ra, rb] = await Promise.all([a.leafHashes(0, 3), b.leafHashes(0, 3)]);
    expect(ra.map(bytesToHex)).toEqual([0, 1, 2].map(leafHex));
    expect(rb.map(bytesToHex)).toEqual([0, 1, 2].map(leafHex));
    expect(lists.get("log:leaves")).toEqual([0, 1, 2].map(quotedLeaf));
  });

  it("computes a range past the end of the leaf list without writing a gap", async () => {
    const { log, lists } = legacyLog(5);
    expect((await log.leafHashes(3, 2)).map(bytesToHex)).toEqual([leafHex(3), leafHex(4)]);
    expect(lists.get("log:leaves") ?? []).toEqual([]);
    expect(await log.leafHashes(5, 3)).toEqual([]);
    expect(await log.leafHashes(0, 0)).toEqual([]);
  });

  it("accepts leaves Upstash has already unquoted and fails loudly on a corrupt one", async () => {
    const { redis, lists } = fakeRedis();
    lists.set("log:records", [0, 1, 2].map((i) => JSON.stringify(rec(i))));
    lists.set("log:leaves", [leafHex(0), quotedLeaf(1), "not-a-hash"]);
    const log = createRedisLogStore(redis);
    expect((await log.leafHashes(0, 2)).map(bytesToHex)).toEqual([leafHex(0), leafHex(1)]);
    await expect(log.leafHashes(0, 3)).rejects.toThrow("leaf hash at index 2");
  });
});
