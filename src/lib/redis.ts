import { Redis } from "@upstash/redis";
import { createMemoryLogStore, createRedisLogStore, type LogStore } from "@/lib/log-store";
import { createMemoryStore, createRedisCounterStore, type CounterStore } from "@/lib/rate-limit";
import { createMemoryRecordStore, createRedisRecordStore, type RecordStore } from "@/lib/record-store";

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
}
const memoryKey = "__contentproofMemoryStores" as const;
const globalStores = globalThis as typeof globalThis & { [memoryKey]?: MemoryStores };
const memory: MemoryStores =
  globalStores[memoryKey] ??
  (globalStores[memoryKey] = {
    counters: createMemoryStore(),
    records: createMemoryRecordStore(),
    log: createMemoryLogStore(),
  });

let redisCounters: CounterStore | null = null;
let redisRecords: RecordStore | null = null;
let redisLog: LogStore | null = null;

export function getCounterStore(): CounterStore {
  const redis = getRedis();
  if (!redis) return memory.counters;
  if (!redisCounters) redisCounters = createRedisCounterStore(redis);
  return redisCounters;
}

export function getRecordStore(): RecordStore {
  const redis = getRedis();
  if (!redis) return memory.records;
  if (!redisRecords) redisRecords = createRedisRecordStore(redis);
  return redisRecords;
}

/** The append-only transparency log. Entries never expire. */
export function getLogStore(): LogStore {
  const redis = getRedis();
  if (!redis) return memory.log;
  if (!redisLog) redisLog = createRedisLogStore(redis);
  return redisLog;
}
