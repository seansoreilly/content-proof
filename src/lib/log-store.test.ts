import { describe, expect, it } from "vitest";
import type { Redis } from "@upstash/redis";
import { APPEND_SCRIPT, createRedisLogStore } from "@/lib/log-store";
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
      if (script !== APPEND_SCRIPT) throw new Error("unexpected script");
      const list = lists.get(keys[0]) ?? [];
      const length = list.push(String(args[0]));
      lists.set(keys[0], list);
      strings.set(keys[1], String(length - 1));
      return length;
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
  it("appends the entry and its signature index in a single script call", async () => {
    const { redis, calls, strings } = fakeRedis();
    const log = createRedisLogStore(redis);

    expect(await log.append(rec(0))).toBe(0);
    expect(await log.append(rec(1))).toBe(1);

    expect(calls.map((c) => c.method)).toEqual(["eval", "eval"]);
    expect(calls[1].args).toEqual([APPEND_SCRIPT, ["log:records", `logidx:${rec(1).s}`], [JSON.stringify(rec(1))]]);
    expect(strings.get(`logidx:${rec(1).s}`)).toBe("1");

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
