import { kv } from "@vercel/kv";

// Check if KV environment variables are available
const isKvAvailable = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

// Mock Redis client for local development when KV is not available
const mockRedis = {
  async get<T = string>(key: string): Promise<T | null> {
    console.warn(`[DEV] Redis GET ${key} - using mock (returns null)`);
    return null;
  },
  async set(key: string): Promise<string> {
    console.warn(`[DEV] Redis SET ${key} - using mock`);
    return "OK";
  },
  async incr(key: string): Promise<number> {
    console.warn(`[DEV] Redis INCR ${key} - using mock (returns 1)`);
    return 1;
  },
  async expire(key: string, seconds: number): Promise<number> {
    console.warn(`[DEV] Redis EXPIRE ${key} ${seconds}s - using mock`);
    return 1;
  }
};

// Vercel KV client. Uses mock for local development when KV environment variables are missing.
export const redis = isKvAvailable ? kv : mockRedis;

export type RedisJson = Record<string, unknown> | string | number | null; 