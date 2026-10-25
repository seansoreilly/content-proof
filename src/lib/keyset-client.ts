import { parsePublicKeysJson, type PublicKeysJson } from "@/lib/keyset";

const CACHE_KEY = "contentproof.public-keys.v1";
/** A saved copy older than this is ignored, so a long-offline browser cannot trust stale keys forever. */
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PUBLIC_KEYS_PATH = "/.well-known/public-keys.json";

export interface PublicKeysLoad {
  keys: PublicKeysJson;
  /** Whether the keys came from the network or from the offline cache. */
  source: "network" | "cache";
}

function readCache(now: number = Date.now()): PublicKeysJson | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    // The old format was the bare keys document; with no savedAt it counts as expired.
    if (typeof stored !== "object" || stored === null) return null;
    const { savedAt, keys } = stored as { savedAt?: unknown; keys?: unknown };
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
    if (now - savedAt > CACHE_MAX_AGE_MS || savedAt - now > CACHE_MAX_AGE_MS) return null;
    return parsePublicKeysJson(keys);
  } catch {
    return null;
  }
}

function writeCache(keys: PublicKeysJson): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), keys }));
  } catch {
    // Storage may be unavailable (private mode, quota); the page still works.
  }
}

/**
 * Load the service's published verification keys. Always prefers the network
 * so a rotation or revocation is seen immediately, and falls back to the last
 * good copy (at most 30 days old) so verification keeps working offline. This
 * cache holds only keys the service itself published, never anything carried
 * in a record.
 */
export async function loadPublicKeys(fetchImpl: typeof fetch = fetch): Promise<PublicKeysLoad> {
  try {
    const response = await fetchImpl(PUBLIC_KEYS_PATH, { cache: "no-store" });
    if (response.ok) {
      const keys = parsePublicKeysJson(await response.json());
      if (keys) {
        writeCache(keys);
        return { keys, source: "network" };
      }
    }
  } catch {
    // fall through to cache
  }
  const cached = readCache();
  if (cached) return { keys: cached, source: "cache" };
  throw new Error("Published keys could not be loaded. Check your connection and try again.");
}
