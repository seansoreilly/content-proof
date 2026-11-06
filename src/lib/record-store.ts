import type { Redis } from "@upstash/redis";
import { parseRecordObject, type SignatureRecord } from "@/lib/record";

/**
 * Lookup store for issued records, keyed by signature, so /sig/<signature>
 * can show a record from its signature alone. Unlike the transparency log
 * (log-store.ts) this is a cache with a TTL, not an audit trail.
 */
export interface RecordStore {
  put(record: SignatureRecord): Promise<void>;
  get(signature: string): Promise<SignatureRecord | null>;
}

const RECORD_PREFIX = "sig:";
const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60;

/**
 * Decode a record read back from Redis. Upstash auto-deserialises values
 * that look like JSON, so the same key can come back as a string or as an
 * object depending on the client and the value; accept both. A corrupt value
 * is reported as missing rather than thrown, so one bad entry cannot break a
 * page or a whole log range.
 */
export function parseStoredRecord(raw: unknown): SignatureRecord | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return parseRecordObject(raw);
  try {
    return parseRecordObject(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function createMemoryRecordStore(): RecordStore {
  const records = new Map<string, SignatureRecord>();
  return {
    async put(record) {
      records.set(record.s, record);
    },
    async get(signature) {
      return records.get(signature) ?? null;
    },
  };
}

export function createRedisRecordStore(redis: Redis): RecordStore {
  return {
    async put(record) {
      await redis.set(`${RECORD_PREFIX}${record.s}`, JSON.stringify(record), { ex: RECORD_TTL_SECONDS });
    },
    async get(signature) {
      const raw = await redis.get<unknown>(`${RECORD_PREFIX}${signature}`);
      const record = parseStoredRecord(raw);
      // Reported as not found to the caller, but corruption should not pass unnoticed.
      if (!record && raw !== null && raw !== undefined) {
        console.warn(`[record-store] corrupt stored record for ${RECORD_PREFIX}${signature.slice(0, 16)}…`);
      }
      return record;
    },
  };
}
