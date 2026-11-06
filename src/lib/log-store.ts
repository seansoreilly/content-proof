import type { Redis } from "@upstash/redis";
import type { SignatureRecord } from "@/lib/record";
import { parseStoredRecord } from "@/lib/record-store";

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

/**
 * Unlike the record store, the log must not treat a corrupt entry as missing:
 * dropping it from a range would shift every later index and the service
 * would sign a tree head over the wrong leaves. Fail loudly instead, so the
 * log endpoints answer 503 until the entry is repaired.
 */
function parseLogEntry(raw: unknown, index: number): SignatureRecord | null {
  if (raw === null || raw === undefined) return null;
  const record = parseStoredRecord(raw);
  if (!record) throw new Error(`Corrupt transparency log entry at index ${index}`);
  return record;
}

/**
 * RPUSH the entry and SET its signature index in one Lua script, so Redis
 * runs both or neither. As two calls, a failure between them left an entry in
 * the log that `indexOf` (and so proofs by signature) could never find. The
 * index is the new length minus one, which only the RPUSH result knows.
 */
export const APPEND_SCRIPT = `
local length = redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], tostring(length - 1))
return length
`;

export function createRedisLogStore(redis: Redis): LogStore {
  return {
    async append(record) {
      const length = await redis.eval<[string], number | string>(
        APPEND_SCRIPT,
        [LIST_KEY, `${INDEX_PREFIX}${record.s}`],
        [JSON.stringify(record)]
      );
      return Number(length) - 1;
    },
    async size() {
      return redis.llen(LIST_KEY);
    },
    async get(index) {
      if (index < 0) return null;
      return parseLogEntry(await redis.lindex(LIST_KEY, index), index);
    },
    async range(from, count) {
      if (count <= 0) return [];
      const start = Math.max(0, from);
      const raw = await redis.lrange<unknown>(LIST_KEY, start, start + count - 1);
      return raw.map((entry, i) => parseLogEntry(entry, start + i)).filter((r): r is SignatureRecord => r !== null);
    },
    async indexOf(signature) {
      const raw = await redis.get<number | string>(`${INDEX_PREFIX}${signature}`);
      if (raw === null || raw === undefined) return null;
      const index = typeof raw === "number" ? raw : Number(raw);
      return Number.isInteger(index) ? index : null;
    },
  };
}
