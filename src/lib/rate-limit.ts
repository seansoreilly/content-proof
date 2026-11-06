import type { Redis } from "@upstash/redis";

/**
 * Fixed-window rate limiting over an injectable counter store so it can run
 * against Redis in production, an in-memory map in development, and a
 * controllable fake in tests.
 */
export interface CounterStore {
  /**
   * Increment `key` and make sure it expires within `seconds`, as one atomic
   * step. Doing the two separately would leave a counter without a TTL if the
   * second call failed, locking that client out for good.
   */
  incrWithExpiry(key: string, seconds: number): Promise<number>;
}

export interface RateLimitOptions {
  /** Maximum requests per window. */
  limit: number;
  windowSeconds: number;
  /** Namespace for keys so different limiters never collide. */
  prefix: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
}

export type RateLimiter = (key: string) => Promise<RateLimitDecision>;

const MEMORY_SWEEP_THRESHOLD = 10_000;

export function createMemoryStore(now: () => number = () => Date.now()): CounterStore {
  const entries = new Map<string, { count: number; expiresAt: number }>();
  return {
    async incrWithExpiry(key, seconds) {
      const entry = entries.get(key);
      if (!entry || now() >= entry.expiresAt) {
        // Bound memory against many distinct client IPs: drop expired windows now and then.
        if (entries.size >= MEMORY_SWEEP_THRESHOLD) {
          for (const [k, e] of entries) if (now() >= e.expiresAt) entries.delete(k);
        }
        entries.set(key, { count: 1, expiresAt: now() + seconds * 1000 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
  };
}

/**
 * INCR and, if the key has no TTL, EXPIRE, in one Lua script so Redis runs
 * them atomically. Checking the TTL rather than `count == 1` also repairs a
 * counter left without one by the old two-call implementation.
 */
export const INCR_WITH_EXPIRY_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) == -1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export function createRedisCounterStore(redis: Redis): CounterStore {
  return {
    async incrWithExpiry(key, seconds) {
      const count = await redis.eval<[string], number | string>(INCR_WITH_EXPIRY_SCRIPT, [key], [String(seconds)]);
      return Number(count);
    },
  };
}

export function createRateLimiter(store: CounterStore, options: RateLimitOptions): RateLimiter {
  const { limit, windowSeconds, prefix } = options;
  return async (key) => {
    const storeKey = `${prefix}:${key}`;
    try {
      const count = await store.incrWithExpiry(storeKey, windowSeconds);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
    } catch (error) {
      // Fail open: an unavailable counter store must not take the service down.
      console.warn("[rate-limit] store unavailable, allowing request", error);
      return { allowed: true, remaining: limit };
    }
  };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

/**
 * 429 response. Carries only a generic message, never internals. `extraHeaders`
 * lets public endpoints add CORS headers so browsers can read the status.
 */
export function rateLimitedResponse(
  decision: RateLimitDecision,
  limit: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      ...extraHeaders,
      "content-type": "application/json",
      "retry-after": "60",
      "x-ratelimit-limit": String(limit),
      "x-ratelimit-remaining": String(decision.remaining),
    },
  });
}
