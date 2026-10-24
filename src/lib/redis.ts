import { Redis } from "@upstash/redis";
import { createMemoryStore, type CounterStore } from "@/lib/rate-limit";
import { parseRecordObject, type SignatureRecord } from "@/lib/record";

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

const memoryCounters = createMemoryStore();

export function getCounterStore(): CounterStore {
  const redis = getRedis();
  if (!redis) return memoryCounters;
  return {
    incr: (key) => redis.incr(key),
    expire: (key, seconds) => redis.expire(key, seconds),
  };
}

export interface RecordStore {
  put(record: SignatureRecord): Promise<void>;
  get(signature: string): Promise<SignatureRecord | null>;
}

const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60;
const memoryRecords = new Map<string, SignatureRecord>();

export function getRecordStore(): RecordStore {
  const redis = getRedis();
  if (!redis) {
    return {
      async put(record) {
        memoryRecords.set(record.s, record);
      },
      async get(signature) {
        return memoryRecords.get(signature) ?? null;
      },
    };
  }
  return {
    async put(record) {
      await redis.set(`sig:${record.s}`, JSON.stringify(record), { ex: RECORD_TTL_SECONDS });
    },
    async get(signature) {
      const raw = await redis.get<unknown>(`sig:${signature}`);
      if (raw === null || raw === undefined) return null;
      // Upstash auto-deserialises JSON; tolerate either shape.
      const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
      return parseRecordObject(parsed);
    },
  };
}
