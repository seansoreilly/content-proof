import type { Redis } from "@upstash/redis";

/**
 * Which browser keys each account has signed with, and which are revoked.
 *
 * A browser key is bound to an account only by the service's say-so at
 * signing time, so the registry pins each key to the first account that used
 * it. That stops one account's key being presented under another account,
 * and gives the account holder a way to retire a key from a lost or shared
 * device: once revoked, the service refuses to countersign with it, for good.
 *
 * Emails are compared lowercased. Timestamps are milliseconds since the epoch.
 */
export interface UserKeyEntry {
  publicKey: string;
  firstSeen: number;
  lastSeen: number;
  revokedAt?: number;
}

/** What is known about a key without knowing the account, for status lookups. */
export interface UserKeyOwner {
  email: string;
  revokedAt?: number;
}

export type TouchResult = "recorded" | "revoked" | "other-account";

export interface UserKeyRegistry {
  /** The key's owner and revocation state, or null for a key never seen. */
  lookup(publicKey: string): Promise<UserKeyOwner | null>;
  /**
   * Record that `email` signed with the key at `now`. Never un-revokes a key
   * and never moves a key to a second account; those cases are reported
   * instead of written.
   */
  touch(email: string, publicKey: string, now: number): Promise<TouchResult>;
  /** The account's keys, most recently used first. */
  list(email: string): Promise<UserKeyEntry[]>;
  /**
   * Revoke one of the account's keys. Returns the updated entry, or null when
   * the account has no such key. Revoking again keeps the first `revokedAt`.
   */
  revoke(email: string, publicKey: string, now: number): Promise<UserKeyEntry | null>;
}

const KEYS_PREFIX = "ukeys:";
const OWNER_PREFIX = "ukey:";

/**
 * The stored owner entry for a key exists but cannot be read. Unlike an
 * outage this is not a reason to fail open: the entry might have recorded a
 * revocation. Identified by `name` as well, since route bundles can hold
 * their own copy of this class.
 */
export class CorruptKeyEntryError extends Error {
  constructor(publicKey: string) {
    super(`Corrupt key owner entry for ${OWNER_PREFIX}${publicKey.slice(0, 16)}…`);
    this.name = "CorruptKeyEntryError";
  }
}

export function isCorruptKeyEntryError(error: unknown): boolean {
  return error instanceof Error && error.name === "CorruptKeyEntryError";
}

function normalise(email: string): string {
  return email.toLowerCase();
}

function byLastSeen(a: UserKeyEntry, b: UserKeyEntry): number {
  return b.lastSeen - a.lastSeen;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Decode a stored entry (a JSON string, or an object Upstash already parsed); null if corrupt. */
export function parseUserKeyEntry(raw: unknown): UserKeyEntry | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const { publicKey, firstSeen, lastSeen, revokedAt } = value as Record<string, unknown>;
  if (typeof publicKey !== "string" || !isFiniteNumber(firstSeen) || !isFiniteNumber(lastSeen)) return null;
  if (revokedAt !== undefined && revokedAt !== null && !isFiniteNumber(revokedAt)) return null;
  return isFiniteNumber(revokedAt) ? { publicKey, firstSeen, lastSeen, revokedAt } : { publicKey, firstSeen, lastSeen };
}

/** Decode a stored owner entry; null if corrupt. */
export function parseUserKeyOwner(raw: unknown): UserKeyOwner | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const { email, revokedAt } = value as Record<string, unknown>;
  if (typeof email !== "string") return null;
  return isFiniteNumber(revokedAt) ? { email, revokedAt } : { email };
}

export function createMemoryUserKeyRegistry(): UserKeyRegistry {
  const byEmail = new Map<string, Map<string, UserKeyEntry>>();
  const owners = new Map<string, UserKeyOwner>();

  return {
    async lookup(publicKey) {
      const owner = owners.get(publicKey);
      return owner ? { ...owner } : null;
    },
    async touch(email, publicKey, now) {
      const account = normalise(email);
      const owner = owners.get(publicKey);
      if (owner && owner.email !== account) return "other-account";
      if (owner?.revokedAt !== undefined) return "revoked";
      let keys = byEmail.get(account);
      if (!keys) byEmail.set(account, (keys = new Map()));
      const current = keys.get(publicKey);
      keys.set(
        publicKey,
        current
          ? { ...current, lastSeen: Math.max(current.lastSeen, now) }
          : { publicKey, firstSeen: now, lastSeen: now }
      );
      if (!owner) owners.set(publicKey, { email: account });
      return "recorded";
    },
    async list(email) {
      return [...(byEmail.get(normalise(email))?.values() ?? [])].map((entry) => ({ ...entry })).sort(byLastSeen);
    },
    async revoke(email, publicKey, now) {
      const account = normalise(email);
      const current = byEmail.get(account)?.get(publicKey);
      if (!current) return null;
      const revoked: UserKeyEntry = { ...current, revokedAt: current.revokedAt ?? now };
      byEmail.get(account)!.set(publicKey, revoked);
      owners.set(publicKey, { email: account, revokedAt: revoked.revokedAt });
      return { ...revoked };
    },
  };
}

/**
 * Touch, atomically: refuse if the key is owned by another account or
 * revoked, otherwise create the entry or bump `lastSeen` while keeping
 * `firstSeen`, and claim the key for the account if unclaimed. Done in one
 * script because a read-then-write from the server could overwrite a
 * revocation that landed in between and silently un-revoke the key.
 *
 * KEYS[1] = ukeys:<email>, KEYS[2] = ukey:<publicKey>
 * ARGV[1] = email, ARGV[2] = publicKey, ARGV[3] = now
 */
export const TOUCH_SCRIPT = `
local owner = redis.call('GET', KEYS[2])
if owner then
  local o = cjson.decode(owner)
  if o.email ~= ARGV[1] then return 'other-account' end
  if o.revokedAt then return 'revoked' end
end
local now = tonumber(ARGV[3])
local current = redis.call('HGET', KEYS[1], ARGV[2])
local entry
if current then
  entry = cjson.decode(current)
  if entry.revokedAt then return 'revoked' end
  if now > entry.lastSeen then entry.lastSeen = now end
else
  entry = { publicKey = ARGV[2], firstSeen = now, lastSeen = now }
end
redis.call('HSET', KEYS[1], ARGV[2], cjson.encode(entry))
if not owner then
  redis.call('SET', KEYS[2], cjson.encode({ email = ARGV[1] }))
end
return 'recorded'
`;

/**
 * Revoke, atomically: mark the account's entry and the public owner record
 * together. Returns the updated entry as JSON, or nil when the account has no
 * such key.
 *
 * KEYS[1] = ukeys:<email>, KEYS[2] = ukey:<publicKey>
 * ARGV[1] = email, ARGV[2] = publicKey, ARGV[3] = now
 */
export const REVOKE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[2])
if not current then return false end
local entry = cjson.decode(current)
if not entry.revokedAt then entry.revokedAt = tonumber(ARGV[3]) end
local encoded = cjson.encode(entry)
redis.call('HSET', KEYS[1], ARGV[2], encoded)
redis.call('SET', KEYS[2], cjson.encode({ email = ARGV[1], revokedAt = entry.revokedAt }))
return encoded
`;

export function createRedisUserKeyRegistry(redis: Redis): UserKeyRegistry {
  const keysKey = (email: string): string => `${KEYS_PREFIX}${normalise(email)}`;
  const ownerKey = (publicKey: string): string => `${OWNER_PREFIX}${publicKey}`;

  return {
    async lookup(publicKey) {
      const raw = await redis.get<unknown>(ownerKey(publicKey));
      if (raw === null || raw === undefined) return null;
      const owner = parseUserKeyOwner(raw);
      // A corrupt owner entry must not read as "unknown key": that would let
      // a revoked key sign again. Fail with a distinct error so callers that
      // otherwise fail open can refuse in this case.
      if (!owner) throw new CorruptKeyEntryError(publicKey);
      return owner;
    },
    async touch(email, publicKey, now) {
      const result = await redis.eval<[string, string, string], string>(
        TOUCH_SCRIPT,
        [keysKey(email), ownerKey(publicKey)],
        [normalise(email), publicKey, String(now)]
      );
      if (result === "recorded" || result === "revoked" || result === "other-account") return result;
      throw new Error(`Unexpected key registry result: ${String(result)}`);
    },
    async list(email) {
      const all = await redis.hgetall<Record<string, unknown>>(keysKey(email));
      if (!all) return [];
      return Object.values(all)
        .map(parseUserKeyEntry)
        .filter((entry): entry is UserKeyEntry => entry !== null)
        .sort(byLastSeen);
    },
    async revoke(email, publicKey, now) {
      const result = await redis.eval<[string, string, string], unknown>(
        REVOKE_SCRIPT,
        [keysKey(email), ownerKey(publicKey)],
        [normalise(email), publicKey, String(now)]
      );
      if (result === null || result === undefined || result === false) return null;
      const entry = parseUserKeyEntry(result);
      if (!entry) throw new Error("Unexpected key registry result");
      return entry;
    },
  };
}
