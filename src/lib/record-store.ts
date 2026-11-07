import type { Redis } from "@upstash/redis";
import { isSignatureString, parseRecordObject, type SignatureRecord } from "@/lib/record";

/**
 * Lookup store for issued records, keyed by signature, so /sig/<signature>
 * can show a record from its signature alone. Unlike the transparency log
 * (log-store.ts) this is a cache with a TTL, not an audit trail.
 *
 * Every record is also indexed by its (lowercased) email, so the account page
 * can list what an account has signed without scanning the whole log.
 */
export interface RecordStore {
  /** Store the record and add it to its account's index, as one step. */
  put(record: SignatureRecord): Promise<void>;
  get(signature: string): Promise<SignatureRecord | null>;
  /**
   * The account's records, newest first. Records whose TTL has run out are
   * skipped. Throws `InvalidCursorError` for a malformed cursor.
   */
  listByEmail(email: string, options: ListByEmailOptions): Promise<RecordPage>;
}

export interface ListByEmailOptions {
  limit: number;
  /** `nextCursor` from the previous page; omit for the first page. */
  cursor?: string;
}

export interface RecordPage {
  records: SignatureRecord[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

const RECORD_PREFIX = "sig:";
const EMAIL_INDEX_PREFIX = "sigs:email:";
export const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Redis key of an account's index. Emails are compared case-insensitively. */
export function emailIndexKey(email: string): string {
  return `${EMAIL_INDEX_PREFIX}${email.toLowerCase()}`;
}

/**
 * Pages are keyed by position in time, `<t>.<signature>` of the last entry
 * seen, never by rank: lazily removing expired entries shifts ranks between
 * requests, and a rank cursor would then skip or repeat records. The
 * signature breaks ties between records signed in the same millisecond.
 */
interface Cursor {
  t: number;
  s: string;
}

const CURSOR_RE = /^(0|[1-9]\d{0,15})\.([A-Za-z0-9_-]{86})$/;

export function encodeCursor(cursor: Cursor): string {
  return `${cursor.t}.${cursor.s}`;
}

/** Parse a cursor from a query string; null when malformed. */
export function parseCursor(value: string): Cursor | null {
  const match = CURSOR_RE.exec(value);
  if (!match || !isSignatureString(match[2])) return null;
  return { t: Number(match[1]), s: match[2] };
}

/** Thrown by `listByEmail` for a malformed cursor, so routes can answer 400. */
export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid cursor");
    this.name = "InvalidCursorError";
  }
}

function requireCursor(cursor: string | undefined): Cursor | null {
  if (cursor === undefined) return null;
  const parsed = parseCursor(cursor);
  if (!parsed) throw new InvalidCursorError();
  return parsed;
}

/**
 * Newest-first order: later time first, then signature descending, which is
 * also the order Redis gives equal scores under ZRANGE ... REV.
 */
function isAfterCursor(t: number, s: string, cursor: Cursor | null): boolean {
  if (!cursor) return true;
  return t < cursor.t || (t === cursor.t && s < cursor.s);
}

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

/**
 * In-memory store with the same 365-day expiry as Redis, so listing behaves
 * the same in development. `now` is injectable for tests.
 */
export function createMemoryRecordStore(now: () => number = () => Date.now()): RecordStore {
  const records = new Map<string, { record: SignatureRecord; expiresAt: number }>();
  const byEmail = new Map<string, Map<string, number>>();

  function live(signature: string): SignatureRecord | null {
    const entry = records.get(signature);
    if (!entry) return null;
    if (now() >= entry.expiresAt) {
      records.delete(signature);
      return null;
    }
    return entry.record;
  }

  return {
    async put(record) {
      records.set(record.s, { record, expiresAt: now() + RECORD_TTL_SECONDS * 1000 });
      const key = record.e.toLowerCase();
      let index = byEmail.get(key);
      if (!index) byEmail.set(key, (index = new Map()));
      index.set(record.s, record.t);
    },
    async get(signature) {
      return live(signature);
    },
    async listByEmail(email, { limit, cursor }) {
      const after = requireCursor(cursor);
      const index = byEmail.get(email.toLowerCase());
      if (!index || limit < 1) return { records: [], nextCursor: null };
      const ordered = [...index.entries()]
        .filter(([s, t]) => isAfterCursor(t, s, after))
        .sort(([sa, ta], [sb, tb]) => tb - ta || (sa < sb ? 1 : sa > sb ? -1 : 0));
      const page: SignatureRecord[] = [];
      let more = false;
      for (const [s] of ordered) {
        const record = live(s);
        if (!record) {
          index.delete(s);
          continue;
        }
        if (page.length === limit) {
          more = true;
          break;
        }
        page.push(record);
      }
      const last = page[page.length - 1];
      return { records: page, nextCursor: more && last ? encodeCursor({ t: last.t, s: last.s }) : null };
    },
  };
}

/** Index entries read per round trip while listing; expired entries can make one batch yield little. */
const LIST_BATCH = 50;
/** Upper bound on round trips per page, so a long run of expired entries cannot stall a request. */
const LIST_MAX_BATCHES = 5;

export function createRedisRecordStore(redis: Redis): RecordStore {
  return {
    async put(record) {
      const indexKey = emailIndexKey(record.e);
      // One MULTI/EXEC, so a record is never stored without its index entry or
      // the reverse. The index itself expires a year after the account's last
      // signature, by which time every record it lists has expired too.
      const tx = redis.multi();
      tx.set(`${RECORD_PREFIX}${record.s}`, JSON.stringify(record), { ex: RECORD_TTL_SECONDS });
      tx.zadd(indexKey, { score: record.t, member: record.s });
      tx.expire(indexKey, RECORD_TTL_SECONDS);
      await tx.exec();
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
    async listByEmail(email, { limit, cursor }) {
      const after = requireCursor(cursor);
      if (limit < 1) return { records: [], nextCursor: null };
      const indexKey = emailIndexKey(email);
      const page: SignatureRecord[] = [];
      // A concurrent signature or cleanup can shift ranks between batches and
      // show an entry twice; never return it twice.
      const seen = new Set<string>();
      let more = false;
      let exhausted = false;
      let lastScanned: Cursor | null = null;
      // Walk down from the cursor's time. Entries at exactly that time that
      // sort at or before the cursor were on an earlier page and are skipped.
      let offset = 0;
      for (let batch = 0; batch < LIST_MAX_BATCHES && !more; batch++) {
        // With REV, Redis takes the upper score bound first.
        const flat = await redis.zrange<unknown[]>(indexKey, after ? after.t : "+inf", "-inf", {
          byScore: true,
          rev: true,
          withScores: true,
          offset,
          count: LIST_BATCH,
        });
        const entries: Cursor[] = [];
        for (let i = 0; i + 1 < flat.length; i += 2) {
          entries.push({ s: String(flat[i]), t: Number(flat[i + 1]) });
        }
        offset += entries.length;
        if (entries.length < LIST_BATCH) exhausted = true;

        const fresh = entries.filter((entry) => isAfterCursor(entry.t, entry.s, after) && !seen.has(entry.s));
        if (fresh.length > 0) {
          const raws = await redis.mget<unknown[]>(...fresh.map((entry) => `${RECORD_PREFIX}${entry.s}`));
          const expired: string[] = [];
          for (let i = 0; i < fresh.length; i++) {
            const record = parseStoredRecord(raws[i]);
            if (!record) {
              // Missing means the record's TTL ran out; a corrupt value is as good as gone.
              expired.push(fresh[i].s);
              continue;
            }
            if (page.length === limit) {
              more = true;
              break;
            }
            seen.add(record.s);
            page.push(record);
          }
          lastScanned = fresh[fresh.length - 1];
          if (expired.length > 0) {
            const removed = await redis.zrem(indexKey, ...expired).then(
              () => true,
              () => false // best effort: the entries are skipped again next time
            );
            // Removed entries no longer occupy ranks below the current offset.
            if (removed) offset = Math.max(0, offset - expired.length);
          }
        }
        if (exhausted) break;
      }
      const last = page[page.length - 1];
      if (more && last) return { records: page, nextCursor: encodeCursor({ t: last.t, s: last.s }) };
      // Ran out of round trips inside a long run of expired entries: let the
      // caller continue from the last entry looked at.
      if (!exhausted && lastScanned) return { records: page, nextCursor: encodeCursor(lastScanned) };
      return { records: page, nextCursor: null };
    },
  };
}
