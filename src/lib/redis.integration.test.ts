import { beforeEach, describe, expect, it, vi } from "vitest";
import { Redis } from "@upstash/redis";
import { bytesToHex } from "@/lib/base64";
import { buildPublicKeysJson } from "@/lib/keys";
import { buildConsistencyProof, buildInclusionProof, buildSignedLogHead } from "@/lib/log-head";
import { createRedisLogStore } from "@/lib/log-store";
import {
  recordLeafHash,
  verifyConsistencyResponse,
  verifyInclusionProof,
  verifyLogHead,
  type SignedLogHead,
} from "@/lib/log-verify";
import { computeRoot } from "@/lib/merkle";
import { createRateLimiter, createRedisCounterStore } from "@/lib/rate-limit";
import type { SignatureRecord } from "@/lib/record";
import { createRedisRecordStore, emailIndexKey, RECORD_TTL_SECONDS } from "@/lib/record-store";
import { createRedisUserKeyRegistry } from "@/lib/user-key-registry";
import { makeKeyPair, stubServerKeys } from "@/test/fixtures";
import {
  BASE_TIME,
  rawTestRedis,
  redisIntegrationEnabled,
  signedRecord,
  testRedis,
  userSignedRecord,
} from "@/test/redis-integration";

/**
 * The Redis-backed stores against a real Redis server, through the real
 * `@upstash/redis` client and the Upstash REST protocol. Run with
 * `npm run test:redis`; skipped otherwise. Every test starts from FLUSHDB,
 * which is also why all Redis integration tests live in this one file: two
 * files run in parallel would flush each other's data mid-test.
 */
const pair = makeKeyPair();

function referenceRoot(records: SignatureRecord[]): string {
  return bytesToHex(computeRoot(records.map(recordLeafHash)));
}

function randomPublicKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

describe.skipIf(!redisIntegrationEnabled)("Redis integration (real Redis via the Upstash REST protocol)", () => {
  let redis: Redis;

  beforeEach(async () => {
    stubServerKeys(pair);
    redis = testRedis();
    await redis.flushdb();
  });

  describe("log store", () => {
    it("appends sequentially and get, range, indexOf and leafHashes agree", async () => {
      const store = createRedisLogStore(redis);
      // Every third record is a version 3 (account-key) record.
      const records = Array.from({ length: 12 }, (_, i) => (i % 3 === 2 ? userSignedRecord(i) : signedRecord(i)));
      for (const [i, record] of records.entries()) {
        expect(await store.append(record)).toBe(i);
      }

      expect(await store.size()).toBe(12);
      for (const [i, record] of records.entries()) {
        expect(await store.get(i)).toEqual(record);
        // logidx:<sig> of entry 0 holds "0", which must still read as the number 0.
        expect(await store.indexOf(record.s)).toBe(i);
      }
      expect(await store.get(-1)).toBeNull();
      expect(await store.get(12)).toBeNull();
      expect(await store.indexOf("A".repeat(86))).toBeNull();
      expect(await store.range(0, 12)).toEqual(records);
      expect(await store.range(3, 4)).toEqual(records.slice(3, 7));
      expect(await store.range(10, 50)).toEqual(records.slice(10));
      expect(await store.range(0, 0)).toEqual([]);

      const leaves = await store.leafHashes(0, 12);
      expect(leaves.map(bytesToHex)).toEqual(records.map((r) => bytesToHex(recordLeafHash(r))));
      expect((await store.leafHashes(5, 3)).map(bytesToHex)).toEqual(leaves.slice(5, 8).map(bytesToHex));
      expect(await store.leafHashes(12, 5)).toEqual([]);
      expect(await redis.llen("log:leaves")).toBe(await redis.llen("log:records"));
    });

    it("stores leaf hashes JSON-quoted, so a client that does not auto-parse reads them too", async () => {
      const record = signedRecord(0);
      await createRedisLogStore(redis).append(record);
      const raw = await rawTestRedis().lrange<string>("log:leaves", 0, -1);
      expect(raw).toEqual([JSON.stringify(bytesToHex(recordLeafHash(record)))]);
      const leaves = await createRedisLogStore(rawTestRedis()).leafHashes(0, 1);
      expect(leaves.map(bytesToHex)).toEqual([bytesToHex(recordLeafHash(record))]);
      expect(await createRedisLogStore(rawTestRedis()).get(0)).toEqual(record);
    });

    it("keeps indexes dense and lists in step under 100 concurrent appends", async () => {
      // Four independent clients stand in for four server processes; each
      // client's auto-pipelining batches its own share into one request.
      const stores = Array.from({ length: 4 }, () => createRedisLogStore(testRedis()));
      const store = createRedisLogStore(redis);
      const records = Array.from({ length: 100 }, (_, i) => signedRecord(i));
      const indexes = await Promise.all(records.map((record, i) => stores[i % 4].append(record)));

      expect([...indexes].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(await redis.llen("log:records")).toBe(100);
      expect(await redis.llen("log:leaves")).toBe(100);
      const stored = await store.range(0, 100);
      const leaves = await store.leafHashes(0, 100);
      for (const [n, record] of records.entries()) {
        const index = indexes[n];
        expect(stored[index]).toEqual(record);
        expect(await store.indexOf(record.s)).toBe(index);
        expect(bytesToHex(leaves[index])).toBe(bytesToHex(recordLeafHash(record)));
      }
    });
  });

  describe("log heads and proofs", () => {
    it("signs heads that verify, with inclusion and consistency proofs that verify", async () => {
      const keys = buildPublicKeysJson();
      const store = createRedisLogStore(redis);
      const records = Array.from({ length: 13 }, (_, i) => signedRecord(i));

      const heads: SignedLogHead[] = [];
      for (const [i, record] of records.entries()) {
        await store.append(record);
        if ([1, 2, 5, 8].includes(i + 1)) heads.push(await buildSignedLogHead(store, BASE_TIME + i));
      }
      const head = await buildSignedLogHead(store);
      expect(head.size).toBe(13);
      expect(head.root).toBe(referenceRoot(records));
      expect(verifyLogHead(head, keys)).toBe(true);
      for (const old of heads) {
        expect(verifyLogHead(old, keys)).toBe(true);
        expect(old.root).toBe(referenceRoot(records.slice(0, old.size)));
      }

      for (const [i, record] of records.entries()) {
        const proof = await buildInclusionProof(store, i);
        expect(proof).not.toBeNull();
        expect(verifyInclusionProof(record, proof!, keys)).toBe(true);
      }
      expect(await buildInclusionProof(store, 13)).toBeNull();

      for (const old of [...heads, head]) {
        const result = await buildConsistencyProof(store, old.size);
        if (!result.ok) throw new Error(result.error);
        expect(verifyConsistencyResponse(old, result.response, keys)).toBe(true);
      }

      // A cold process (a new store over the same Redis) computes the same tree.
      const cold = await buildSignedLogHead(createRedisLogStore(testRedis()));
      expect(cold.root).toBe(head.root);
    });
  });

  describe("rate limiter", () => {
    it("counts and sets a TTL on the first increment", async () => {
      const store = createRedisCounterStore(redis);
      expect(await store.incrWithExpiry("rl:a", 60)).toBe(1);
      expect(await store.incrWithExpiry("rl:a", 60)).toBe(2);
      const ttl = await redis.ttl("rl:a");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it("repairs a counter left without a TTL by the old two-call implementation", async () => {
      await redis.incr("rl:stuck");
      await redis.incr("rl:stuck");
      expect(await redis.ttl("rl:stuck")).toBe(-1);
      expect(await createRedisCounterStore(redis).incrWithExpiry("rl:stuck", 30)).toBe(3);
      const ttl = await redis.ttl("rl:stuck");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
    });

    it("does not extend a running window", async () => {
      const store = createRedisCounterStore(redis);
      await store.incrWithExpiry("rl:w", 60);
      await redis.expire("rl:w", 5);
      await store.incrWithExpiry("rl:w", 60);
      const ttl = await redis.ttl("rl:w");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5);
    });

    it("enforces the limit", async () => {
      const limiter = createRateLimiter(createRedisCounterStore(redis), { limit: 3, windowSeconds: 60, prefix: "rl" });
      const decisions = [];
      for (let i = 0; i < 4; i++) decisions.push(await limiter("1.2.3.4"));
      expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
      expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
      expect(await redis.get("rl:1.2.3.4")).toBe(4);
    });

    it("counts 50 concurrent increments exactly, with a TTL", async () => {
      const stores = Array.from({ length: 5 }, () => createRedisCounterStore(testRedis()));
      const counts = await Promise.all(Array.from({ length: 50 }, (_, i) => stores[i % 5].incrWithExpiry("rl:burst", 60)));
      expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect(await redis.get("rl:burst")).toBe(50);
      expect(await redis.ttl("rl:burst")).toBeGreaterThan(0);
    });

    it("fails open when Redis is unreachable", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        // Nothing listens on port 1; no retries, so the failure is immediate.
        const unreachable = new Redis({ url: "http://127.0.0.1:1", token: "x", retry: false, enableTelemetry: false });
        const limiter = createRateLimiter(createRedisCounterStore(unreachable), {
          limit: 1,
          windowSeconds: 60,
          prefix: "rl",
        });
        expect(await limiter("a")).toEqual({ allowed: true, remaining: 1 });
        expect(await limiter("a")).toEqual({ allowed: true, remaining: 1 });
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("record store", () => {
    it("round-trips a record, with the TTL on the record and its index", async () => {
      const store = createRedisRecordStore(redis);
      const record = signedRecord(1, "Alice@Example.com");
      const userSigned = userSignedRecord(2, "alice@example.com");
      await store.put(record);
      await store.put(userSigned);
      expect(await store.get(record.s)).toEqual(record);
      expect(await store.get(userSigned.s)).toEqual(userSigned);
      expect(await store.get("B".repeat(86))).toBeNull();

      const recordTtl = await redis.ttl(`sig:${record.s}`);
      expect(recordTtl).toBeGreaterThan(RECORD_TTL_SECONDS - 60);
      expect(recordTtl).toBeLessThanOrEqual(RECORD_TTL_SECONDS);
      expect(await redis.ttl(emailIndexKey(record.e))).toBeGreaterThan(RECORD_TTL_SECONDS - 60);
      expect(await redis.zscore("sigs:email:alice@example.com", record.s)).toBe(record.t);
    });

    it("lists newest first and paginates with a cursor, case-insensitively", async () => {
      const store = createRedisRecordStore(redis);
      const mine = Array.from({ length: 5 }, (_, i) => signedRecord(i, i % 2 ? "Bob@example.com" : "bob@example.com"));
      await Promise.all(mine.map((r) => store.put(r)));
      await store.put(signedRecord(99, "someone-else@example.com"));
      const newestFirst = [...mine].reverse();

      const first = await store.listByEmail("BOB@example.com", { limit: 2 });
      expect(first.records).toEqual(newestFirst.slice(0, 2));
      expect(first.nextCursor).not.toBeNull();
      const second = await store.listByEmail("bob@example.com", { limit: 2, cursor: first.nextCursor! });
      expect(second.records).toEqual(newestFirst.slice(2, 4));
      const third = await store.listByEmail("bob@example.com", { limit: 2, cursor: second.nextCursor! });
      expect(third.records).toEqual(newestFirst.slice(4));
      expect(third.nextCursor).toBeNull();
      expect(await store.listByEmail("nobody@example.com", { limit: 2 })).toEqual({ records: [], nextCursor: null });
    });

    it("skips expired records, removes them from the index, and keeps paging correctly", async () => {
      const store = createRedisRecordStore(redis);
      // 120 records, three per millisecond (ties are ordered by signature),
      // so the walk crosses several 50-entry batches.
      const records = Array.from({ length: 120 }, (_, i) =>
        signedRecord(i, "carol@example.com", BASE_TIME + Math.floor(i / 3))
      );
      for (const record of records) await store.put(record);

      // Every third record expires: most by DEL, two through a real TTL.
      const gone = records.filter((_, i) => i % 3 === 1);
      await redis.del(...gone.slice(2).map((r) => `sig:${r.s}`));
      await redis.pexpire(`sig:${gone[0].s}`, 1);
      await redis.pexpire(`sig:${gone[1].s}`, 1);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const goneSet = new Set(gone.map((r) => r.s));
      const expected = records
        .filter((r) => !goneSet.has(r.s))
        .sort((a, b) => b.t - a.t || (a.s < b.s ? 1 : a.s > b.s ? -1 : 0));

      const seen: SignatureRecord[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 50; page++) {
        const result = await store.listByEmail("carol@example.com", { limit: 7, cursor });
        seen.push(...result.records);
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      expect(seen.map((r) => r.s)).toEqual(expected.map((r) => r.s));
      expect(await redis.zcard("sigs:email:carol@example.com")).toBe(expected.length);
    });
  });

  describe("user key registry", () => {
    it("records a key, keeps firstSeen, and pins it to its first account", async () => {
      const registry = createRedisUserKeyRegistry(redis);
      const key = randomPublicKey();
      const t = BASE_TIME + 123;

      expect(await registry.touch("Dave@Example.com", key, t)).toBe("recorded");
      expect(await registry.lookup(key)).toEqual({ email: "dave@example.com" });
      // 13-digit millisecond timestamps survive cjson's number formatting exactly.
      expect(await registry.list("dave@example.com")).toEqual([{ publicKey: key, firstSeen: t, lastSeen: t }]);

      expect(await registry.touch("dave@example.com", key, t + 5_000)).toBe("recorded");
      expect(await registry.touch("dave@example.com", key, t + 1_000)).toBe("recorded");
      expect(await registry.list("DAVE@example.com")).toEqual([{ publicKey: key, firstSeen: t, lastSeen: t + 5_000 }]);

      expect(await registry.touch("mallory@example.com", key, t + 6_000)).toBe("other-account");
      expect(await registry.list("mallory@example.com")).toEqual([]);
      expect(await registry.lookup(key)).toEqual({ email: "dave@example.com" });
      expect(await registry.lookup(randomPublicKey())).toBeNull();
    });

    it("lists an account's keys most recently used first", async () => {
      const registry = createRedisUserKeyRegistry(redis);
      const [a, b] = [randomPublicKey(), randomPublicKey()];
      await registry.touch("erin@example.com", a, BASE_TIME + 10);
      await registry.touch("erin@example.com", b, BASE_TIME + 20);
      expect((await registry.list("erin@example.com")).map((e) => e.publicKey)).toEqual([b, a]);
      await registry.touch("erin@example.com", a, BASE_TIME + 30);
      expect((await registry.list("erin@example.com")).map((e) => e.publicKey)).toEqual([a, b]);
    });

    it("revokes for good: touch never un-revokes and a second revoke keeps the first revokedAt", async () => {
      const registry = createRedisUserKeyRegistry(redis);
      const key = randomPublicKey();
      await registry.touch("frank@example.com", key, BASE_TIME);

      expect(await registry.revoke("mallory@example.com", key, BASE_TIME + 1)).toBeNull();
      expect(await registry.revoke("frank@example.com", randomPublicKey(), BASE_TIME + 1)).toBeNull();
      expect(await registry.lookup(key)).toEqual({ email: "frank@example.com" });

      const revoked = await registry.revoke("Frank@example.com", key, BASE_TIME + 1_000);
      expect(revoked).toEqual({ publicKey: key, firstSeen: BASE_TIME, lastSeen: BASE_TIME, revokedAt: BASE_TIME + 1_000 });
      expect(await registry.lookup(key)).toEqual({ email: "frank@example.com", revokedAt: BASE_TIME + 1_000 });

      expect(await registry.touch("frank@example.com", key, BASE_TIME + 2_000)).toBe("revoked");
      expect(await registry.touch("mallory@example.com", key, BASE_TIME + 2_000)).toBe("other-account");
      expect(await registry.lookup(key)).toEqual({ email: "frank@example.com", revokedAt: BASE_TIME + 1_000 });

      const again = await registry.revoke("frank@example.com", key, BASE_TIME + 3_000);
      expect(again?.revokedAt).toBe(BASE_TIME + 1_000);
      expect(await registry.list("frank@example.com")).toEqual([
        { publicKey: key, firstSeen: BASE_TIME, lastSeen: BASE_TIME, revokedAt: BASE_TIME + 1_000 },
      ]);
      expect(await registry.lookup(key)).toEqual({ email: "frank@example.com", revokedAt: BASE_TIME + 1_000 });
    });
  });
});
