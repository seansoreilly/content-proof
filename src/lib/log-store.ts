import type { Redis } from "@upstash/redis";
import { bytesToHex, hexToBytes } from "@/lib/base64";
import { recordLeafHash } from "@/lib/log-verify";
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
  /**
   * Merkle leaf hashes of entries [from, from + count), clipped to the log
   * size. Stored beside the records so the tree head never has to re-read and
   * re-encode every record.
   */
  leafHashes(from: number, count: number): Promise<Uint8Array[]>;
}

export function createMemoryLogStore(): LogStore {
  const entries: SignatureRecord[] = [];
  const leaves: Uint8Array[] = [];
  const bySignature = new Map<string, number>();
  return {
    async append(record) {
      const index = entries.push(record) - 1;
      leaves.push(recordLeafHash(record));
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
    async leafHashes(from, count) {
      const start = Math.max(0, from);
      return leaves.slice(start, start + Math.max(0, count)).map((leaf) => leaf.slice());
    },
  };
}

const LIST_KEY = "log:records";
const LEAVES_KEY = "log:leaves";
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
 *
 * The entry's leaf hash goes onto the parallel `log:leaves` list in the same
 * script, but only when that list was exactly in step with the records. On a
 * deployment that predates the leaf list (or after an append by an older
 * version) it is shorter, and pushing would put this hash at the wrong index.
 * The backfill in `leafHashes` then catches the list up from the records. So
 * `log:leaves` is always a prefix of the records' leaf hashes, never wrong.
 */
export const APPEND_SCRIPT = `
local length = redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], tostring(length - 1))
if redis.call('LLEN', KEYS[3]) == length - 1 then
  redis.call('RPUSH', KEYS[3], ARGV[2])
end
return length
`;

/**
 * Append leaf hashes computed from records [ARGV[1], ARGV[1] + #ARGV - 1),
 * but only if `log:leaves` still ends exactly at ARGV[1]. Two readers
 * backfilling the same range race harmlessly: the second finds the list
 * already longer and writes nothing, so no hash is ever duplicated.
 */
export const BACKFILL_SCRIPT = `
local start = tonumber(ARGV[1])
local count = #ARGV - 1
if redis.call('LLEN', KEYS[1]) ~= start then return 0 end
if redis.call('LLEN', KEYS[2]) < start + count then return 0 end
redis.call('RPUSH', KEYS[1], unpack(ARGV, 2))
return count
`;

/** Hashes per backfill script call, well under Lua's unpack limit. */
const BACKFILL_CHUNK = 500;

/**
 * Leaf hashes are stored JSON-quoted. Upstash parses list values as JSON on
 * read, and a bare hex string made only of digits would come back as a lossy
 * number; quoted, it always comes back as the string. A client that does not
 * parse returns the quoted form, which is accepted too. Like entries, a bad
 * leaf fails loudly rather than being skipped.
 */
function encodeLeaf(leaf: Uint8Array): string {
  return JSON.stringify(bytesToHex(leaf));
}

function parseLeaf(raw: unknown, index: number): Uint8Array {
  let hex = raw;
  if (typeof hex === "string" && hex.startsWith('"')) {
    try {
      hex = JSON.parse(hex);
    } catch {
      hex = null;
    }
  }
  if (typeof hex !== "string" || !/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`Corrupt transparency log leaf hash at index ${index}`);
  }
  return hexToBytes(hex);
}

export function createRedisLogStore(redis: Redis): LogStore {
  async function range(from: number, count: number): Promise<SignatureRecord[]> {
    if (count <= 0) return [];
    const start = Math.max(0, from);
    const raw = await redis.lrange<unknown>(LIST_KEY, start, start + count - 1);
    return raw.map((entry, i) => parseLogEntry(entry, start + i)).filter((r): r is SignatureRecord => r !== null);
  }

  async function backfill(start: number, leaves: Uint8Array[]): Promise<void> {
    for (let i = 0; i < leaves.length; i += BACKFILL_CHUNK) {
      const chunk = leaves.slice(i, i + BACKFILL_CHUNK).map(encodeLeaf);
      const written = await redis.eval<string[], number | string>(
        BACKFILL_SCRIPT,
        [LEAVES_KEY, LIST_KEY],
        [String(start + i), ...chunk]
      );
      // Another reader got there first (or the list ends before `start`); later chunks would not line up either.
      if (Number(written) !== chunk.length) return;
    }
  }

  return {
    async append(record) {
      const length = await redis.eval<[string, string], number | string>(
        APPEND_SCRIPT,
        [LIST_KEY, `${INDEX_PREFIX}${record.s}`, LEAVES_KEY],
        [JSON.stringify(record), encodeLeaf(recordLeafHash(record))]
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
    range,
    async indexOf(signature) {
      const raw = await redis.get<number | string>(`${INDEX_PREFIX}${signature}`);
      if (raw === null || raw === undefined) return null;
      const index = typeof raw === "number" ? raw : Number(raw);
      return Number.isInteger(index) ? index : null;
    },
    async leafHashes(from, count) {
      if (count <= 0) return [];
      const start = Math.max(0, from);
      const raw = await redis.lrange<unknown>(LEAVES_KEY, start, start + count - 1);
      const leaves = raw.map((entry, i) => parseLeaf(entry, start + i));
      if (leaves.length === count) return leaves;

      // The leaf list ends early: these entries were appended before leaf
      // hashes were stored. Compute them from the records and persist them
      // for next time, guarded so concurrent readers cannot duplicate them.
      const missingFrom = start + leaves.length;
      const computed = (await range(missingFrom, count - leaves.length)).map(recordLeafHash);
      if (computed.length > 0) await backfill(missingFrom, computed);
      return [...leaves, ...computed];
    },
  };
}
