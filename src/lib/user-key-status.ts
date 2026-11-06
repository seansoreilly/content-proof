import { isRawPublicKey } from "@/lib/record";

/**
 * Browser-safe client for GET /api/keys/user/<publicKey>, the public
 * revocation status of an account holder's browser key.
 */
export interface UserKeyStatus {
  publicKey: string;
  /** Whether the service has ever countersigned with this key. */
  known: boolean;
  /** When the account holder revoked the key, or null if it is not revoked. */
  revokedAt: number | null;
}

export const USER_KEY_STATUS_PATH = "/api/keys/user/";

/**
 * The exact `error` text of `/api/sign`'s 403 for a revoked key. Shared so the
 * upload page can recognise that answer, replace this browser's key and retry,
 * rather than matching on a copy of the string that could drift.
 */
export const USER_KEY_REVOKED_MESSAGE = "This signing key has been revoked";

/**
 * Fetch a key's status. Resolves to null when the status cannot be had (bad
 * key, network failure, error status, unexpected body), so callers can treat
 * "unknown" separately from "known and not revoked" and never block
 * verification on it.
 */
export async function fetchUserKeyStatus(
  publicKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<UserKeyStatus | null> {
  if (!isRawPublicKey(publicKey)) return null;
  try {
    const res = await fetchImpl(`${USER_KEY_STATUS_PATH}${publicKey}`, { cache: "no-store" });
    if (!res.ok) return null;
    return parseUserKeyStatus(await res.json(), publicKey);
  } catch {
    return null;
  }
}

/** Validate a status body, and that it is about the key that was asked for. */
export function parseUserKeyStatus(body: unknown, publicKey: string): UserKeyStatus | null {
  if (typeof body !== "object" || body === null) return null;
  const { publicKey: key, known, revokedAt } = body as Record<string, unknown>;
  if (key !== publicKey || typeof known !== "boolean") return null;
  if (revokedAt !== null && (typeof revokedAt !== "number" || !Number.isFinite(revokedAt))) return null;
  return { publicKey, known, revokedAt };
}
