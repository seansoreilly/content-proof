import type { Redis } from "@upstash/redis";
import { parseRecordObject, type SignatureRecord } from "@/lib/record";

/**
 * Append-only log of every record the service issues. Entries are never
 * updated or removed; the Merkle tree over the log (see merkle.ts) lets anyone
 * holding a signed tree head detect later tampering or back-dating.
 */
export interface LogStore {
  /** Append a record and return its zero-based index. */
  append(record: SignatureRecord): Promise<number>;
  size(): Promise<number>;
  get(index: number): Promise<SignatureRecord | null>;
  /** Entries [from, from + count). */
  range(from: number, count: number): Promise<SignatureRecord[]>;
  indexOf(signature: string): Promise<number | null>;
}

export function createMemoryLogStore(): LogStore {
  const entries: SignatureRecord[] = [];
  const bySignature = new Map<string, number>();
  return {
    async append(record) {
      const index = entries.push(record) - 1;
      bySignature.set(record.s, index);
      return index;
    },
    async size() {
      return entries.length;
    },
    async get(index) {
      return entries[index] ?? null;
    },
    async range(from, count) {
      return entries.slice(Math.max(0, from), Math.max(0, from) + Math.max(0, count));
    },
    async indexOf(signature) {
      return bySignature.get(signature) ?? null;
    },
  };
}

const LIST_KEY = "log:records";
const INDEX_PREFIX = "logidx:";

function parse(raw: unknown): SignatureRecord | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return parseRecordObject(value);
}

export function createRedisLogStore(redis: Redis): LogStore {
  return {
    async append(record) {
      const length = await redis.rpush(LIST_KEY, JSON.stringify(record));
      const index = length - 1;
      await redis.set(`${INDEX_PREFIX}${record.s}`, index);
      return index;
    },
    async size() {
      return redis.llen(LIST_KEY);
    },
    async get(index) {
      if (index < 0) return null;
      return parse(await redis.lindex(LIST_KEY, index));
    },
    async range(from, count) {
      if (count <= 0) return [];
      const start = Math.max(0, from);
      const raw = await redis.lrange<unknown>(LIST_KEY, start, start + count - 1);
      return raw.map(parse).filter((r): r is SignatureRecord => r !== null);
    },
    async indexOf(signature) {
      const raw = await redis.get<number | string>(`${INDEX_PREFIX}${signature}`);
      if (raw === null || raw === undefined) return null;
      const index = typeof raw === "number" ? raw : Number(raw);
      return Number.isInteger(index) ? index : null;
    },
  };
}
