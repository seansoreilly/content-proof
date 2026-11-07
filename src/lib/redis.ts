import { Redis } from "@upstash/redis";
import { createMemoryLogStore, createRedisLogStore, type LogStore } from "@/lib/log-store";
import { createMemoryStore, createRedisCounterStore, type CounterStore } from "@/lib/rate-limit";
import { createMemoryRecordStore, createRedisRecordStore, type RecordStore } from "@/lib/record-store";
import { createMemoryUserKeyRegistry, createRedisUserKeyRegistry, type UserKeyRegistry } from "@/lib/user-key-registry";

export type { RecordStore } from "@/lib/record-store";

/**
 * Optional Upstash Redis backing for rate limiting and record storage. The
 * service works without it (in-memory fallbacks), but then limits are
 * per-instance and stored records do not survive a restart.
 *
 * Accepts either the Upstash variable names or the legacy Vercel KV names.
 */
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

/**
 * In-memory fallbacks live on globalThis so that every bundle layer in a Next
 * process (route handlers, server components) shares one instance. Without
 * this, a record written by /api/sign would be invisible to the /sig page in
 * development.
 */
interface MemoryStores {
  counters: CounterStore;
  records: RecordStore;
  log: LogStore;
  userKeys: UserKeyRegistry;
}
const memoryKey = "__contentproofMemoryStores" as const;
const globalStores = globalThis as typeof globalThis & { [memoryKey]?: MemoryStores };
const memory: MemoryStores =
  globalStores[memoryKey] ??
  (globalStores[memoryKey] = {
    counters: createMemoryStore(),
    records: createMemoryRecordStore(),
    log: createMemoryLogStore(),
    userKeys: createMemoryUserKeyRegistry(),
  });
// A holder created by an older bundle (before hot reload added a store) lacks the newer fields.
memory.userKeys ??= createMemoryUserKeyRegistry();

let redisCounters: CounterStore | null = null;
let redisRecords: RecordStore | null = null;
let redisLog: LogStore | null = null;
let redisUserKeys: UserKeyRegistry | null = null;

export function getCounterStore(): CounterStore {
  const redis = getRedis();
  if (!redis) return memory.counters;
  if (!redisCounters) redisCounters = createRedisCounterStore(redis);
  return redisCounters;
}

export interface StorageStatus {
  /** Whether records and the transparency log survive a restart. */
  durable: boolean;
  backend: "redis" | "memory";
}

let warnedEphemeral = false;

/**
 * In production the memory fallback means every restart or new instance
 * silently loses the record store and the transparency log, and the tree
 * heads archived so far stop matching. That is a misconfiguration, but one
 * the service can still limp along with, so it is reported loudly once per
 * process rather than refused. Called from the record and log accessors, not
 * the counter store, which route modules touch at import time during
 * `next build`.
 */
function warnIfEphemeral(redis: Redis | null): void {
  if (redis || warnedEphemeral || process.env.NODE_ENV !== "production") return;
  warnedEphemeral = true;
  console.error(
    "[storage] Redis is not configured (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN). " +
      "Using the in-memory fallback: issued records and the transparency log WILL NOT PERSIST " +
      "across restarts or instances."
  );
}

/** Which backend the stores use, for /api/health. */
export function storageStatus(): StorageStatus {
  const redis = getRedis();
  warnIfEphemeral(redis);
  return redis ? { durable: true, backend: "redis" } : { durable: false, backend: "memory" };
}

export function getRecordStore(): RecordStore {
  const redis = getRedis();
  warnIfEphemeral(redis);
  if (!redis) return memory.records;
  if (!redisRecords) redisRecords = createRedisRecordStore(redis);
  return redisRecords;
}

/** The append-only transparency log. Entries never expire. */
export function getLogStore(): LogStore {
  const redis = getRedis();
  warnIfEphemeral(redis);
  if (!redis) return memory.log;
  if (!redisLog) redisLog = createRedisLogStore(redis);
  return redisLog;
}

/** Account browser keys and their revocation state. */
export function getUserKeyRegistry(): UserKeyRegistry {
  const redis = getRedis();
  warnIfEphemeral(redis);
  if (!redis) return memory.userKeys;
  if (!redisUserKeys) redisUserKeys = createRedisUserKeyRegistry(redis);
  return redisUserKeys;
}
