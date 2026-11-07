import { generateKeyPairSync, sign } from "node:crypto";
import { Redis } from "@upstash/redis";
import { signFileHash } from "@/lib/crypto/ed25519";
import { buildSignedMessage, type SignatureRecord } from "@/lib/record";
import { sha256Hex } from "@/test/fixtures";

/**
 * Shared set-up for `src/lib/redis.integration.test.ts`, which runs against a
 * real Redis behind the Upstash REST protocol (`npm run test:redis`). It is
 * skipped unless REDIS_TEST_URL and REDIS_TEST_TOKEN are set, and it runs
 * FLUSHDB before every test, so the target must be a dedicated throwaway
 * database.
 */
const url = process.env.REDIS_TEST_URL;
const token = process.env.REDIS_TEST_TOKEN;

export const redisIntegrationEnabled = Boolean(url && token);

/**
 * A client configured like production's `getRedis()` (auto-pipelining and
 * base64 response encoding on, the library defaults), minus telemetry. Each
 * call returns an independent client, which is how a test stands in for a
 * second server process.
 */
export function testRedis(): Redis {
  if (!url || !token) throw new Error("REDIS_TEST_URL and REDIS_TEST_TOKEN must be set");
  return new Redis({ url, token, enableTelemetry: false });
}

/** A client that returns values exactly as stored, without JSON auto-parsing. */
export function rawTestRedis(): Redis {
  if (!url || !token) throw new Error("REDIS_TEST_URL and REDIS_TEST_TOKEN must be set");
  return new Redis({ url, token, enableTelemetry: false, automaticDeserialization: false });
}

/**
 * Wrap a client so every `eval` script it runs is recorded, leaving all else
 * untouched. Used to count how often a store ran a given Lua script.
 */
export function countEvals(redis: Redis): { redis: Redis; scripts: string[] } {
  const scripts: string[] = [];
  const wrapped = new Proxy(redis, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      if (property === "eval") {
        return (script: string, ...rest: unknown[]) => {
          scripts.push(script);
          return (value as (...args: unknown[]) => unknown).call(target, script, ...rest);
        };
      }
      return (value as (...args: unknown[]) => unknown).bind(target);
    },
  });
  return { redis: wrapped, scripts };
}

export const BASE_TIME = 1_762_500_000_000;

/** A genuine record signed with the stubbed server key, distinct per `i`. */
export function signedRecord(i: number, email = `user${i % 3}@example.com`, timestamp = BASE_TIME + i): SignatureRecord {
  return signFileHash(sha256Hex(`integration file ${i}`), email, timestamp);
}

/** A genuine version 3 record: signed by a fresh account key, then countersigned. */
export function userSignedRecord(i: number, email = `user${i % 3}@example.com`, timestamp = BASE_TIME + i): SignatureRecord {
  const hashHex = sha256Hex(`integration file ${i}`);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  // The raw key is the last 32 bytes of the SPKI DER encoding.
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
  const signature = sign(null, Buffer.from(buildSignedMessage(hashHex, email, timestamp), "utf8"), privateKey);
  return signFileHash(hashHex, email, timestamp, { publicKey: raw, signature: signature.toString("base64url") });
}
