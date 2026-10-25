import { parsePublicKeysJson, type PublicKeysJson } from "@/lib/keyset";

const CACHE_KEY = "contentproof.public-keys.v1";
export const PUBLIC_KEYS_PATH = "/.well-known/public-keys.json";

export interface PublicKeysLoad {
  keys: PublicKeysJson;
  /** Whether the keys came from the network or from the offline cache. */
  source: "network" | "cache";
}

function readCache(): PublicKeysJson | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? parsePublicKeysJson(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(keys: PublicKeysJson): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(keys));
  } catch {
    // Storage may be unavailable (private mode, quota); the page still works.
  }
}

/**
 * Load the service's published verification keys. Always prefers the network
 * so a rotation or revocation is seen immediately, and falls back to the last
 * good copy so verification keeps working offline. This cache holds only keys
 * the service itself published, never anything carried in a record.
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
  throw new Error("Verification keys are unavailable (offline and nothing cached yet).");
}
