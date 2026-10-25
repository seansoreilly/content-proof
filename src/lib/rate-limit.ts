/**
 * Fixed-window rate limiting over an injectable counter store so it can run
 * against Redis in production, an in-memory map in development, and a
 * controllable fake in tests.
 */
export interface CounterStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
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

export function createMemoryStore(now: () => number = () => Date.now()): CounterStore {
  const entries = new Map<string, { count: number; expiresAt: number }>();
  return {
    async incr(key) {
      const entry = entries.get(key);
      if (!entry || now() >= entry.expiresAt) {
        entries.set(key, { count: 1, expiresAt: Number.POSITIVE_INFINITY });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
    async expire(key, seconds) {
      const entry = entries.get(key);
      if (entry) entry.expiresAt = now() + seconds * 1000;
      return 1;
    },
  };
}

export function createRateLimiter(store: CounterStore, options: RateLimitOptions): RateLimiter {
  const { limit, windowSeconds, prefix } = options;
  return async (key) => {
    const storeKey = `${prefix}:${key}`;
    try {
      const count = await store.incr(storeKey);
      if (count === 1) await store.expire(storeKey, windowSeconds);
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

export function rateLimitedResponse(): Response {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "60" },
  });
}
