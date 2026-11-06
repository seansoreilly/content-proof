import { toBase64Url } from "@/lib/base64";

/**
 * The account holder's own signing key.
 *
 * Generated with WebCrypto as a NON-EXTRACTABLE Ed25519 key, so even the page's
 * own JavaScript cannot read the private half; it can only ask the browser to
 * sign. The key never leaves the device: the service receives the public key
 * and signatures only. Persisted in IndexedDB (CryptoKey objects survive
 * structured cloning) so the same key is used across visits in this browser.
 *
 * Each browser therefore has its own key. A person using two devices has two
 * keys; every record names the key that signed it. Publishing your key
 * fingerprint somewhere you control lets verifiers tie records to you beyond
 * the service's say-so.
 */
export interface UserSigningKey {
  /** base64url raw 32-byte public key, as carried in records. */
  publicKey: string;
  sign(message: string): Promise<string>;
}

const ALGORITHM = { name: "Ed25519" } as const;
const DB_NAME = "contentproof";
const STORE = "keys";
const RECORD_ID = "signing-key";

interface StoredKey {
  id: typeof RECORD_ID;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  createdAt: number;
}

export function userKeysSupported(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle?.generateKey === "function";
}

/** Generate a fresh non-extractable Ed25519 pair. Works in browsers and Node 18+. */
export async function generateUserKeyPair(): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, false, ["sign", "verify"]);
  if (!("privateKey" in pair)) throw new Error("Ed25519 key generation returned a symmetric key");
  return pair;
}

export async function exportRawPublicKey(publicKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
  if (raw.length !== 32) throw new Error("Unexpected Ed25519 public key length");
  return toBase64Url(raw);
}

export async function signWithUserKey(privateKey: CryptoKey, message: string): Promise<string> {
  const signature = new Uint8Array(
    await crypto.subtle.sign(ALGORITHM, privateKey, new TextEncoder().encode(message))
  );
  return toBase64Url(signature);
}

export async function toUserSigningKey(pair: CryptoKeyPair): Promise<UserSigningKey> {
  const publicKey = await exportRawPublicKey(pair.publicKey);
  return { publicKey, sign: (message) => signWithUserKey(pair.privateKey, message) };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function loadStoredKey(db: IDBDatabase): Promise<StoredKey | undefined> {
  const tx = db.transaction(STORE, "readonly");
  return idbRequest(tx.objectStore(STORE).get(RECORD_ID) as IDBRequest<StoredKey | undefined>);
}

async function saveStoredKey(db: IDBDatabase, value: StoredKey): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  await idbRequest(tx.objectStore(STORE).put(value));
}

/** Open the key store, or throw when this browser cannot hold a key at all. */
async function openKeyStore(): Promise<IDBDatabase> {
  if (!userKeysSupported() || typeof indexedDB === "undefined") {
    throw new Error("This browser cannot hold a signing key");
  }
  return openDb();
}

/**
 * Browser only. Returns this browser's signing key, creating and persisting one
 * on first use. Throws when WebCrypto Ed25519 or IndexedDB is unavailable; the
 * caller falls back to a service-only (version 2) record.
 */
export async function getOrCreateUserKey(): Promise<UserSigningKey> {
  const db = await openKeyStore();
  try {
    const existing = await loadStoredKey(db);
    if (existing) return toUserSigningKey({ privateKey: existing.privateKey, publicKey: existing.publicKey });
    const pair = await generateUserKeyPair();
    await saveStoredKey(db, { id: RECORD_ID, privateKey: pair.privateKey, publicKey: pair.publicKey, createdAt: Date.now() });
    return toUserSigningKey(pair);
  } finally {
    db.close();
  }
}

/**
 * Browser only. Replaces this browser's signing key with a fresh pair and
 * returns it. Used once the account holder has revoked the old key: the
 * service refuses to countersign with a revoked key for good, so without a
 * new one this browser could never sign again. The new pair overwrites the
 * stored record in a single write, so a reader sees the old key or the new
 * one, never neither. Throws exactly as `getOrCreateUserKey` does.
 */
export async function rotateUserKey(): Promise<UserSigningKey> {
  const db = await openKeyStore();
  try {
    const pair = await generateUserKeyPair();
    await saveStoredKey(db, { id: RECORD_ID, privateKey: pair.privateKey, publicKey: pair.publicKey, createdAt: Date.now() });
    return toUserSigningKey(pair);
  } finally {
    db.close();
  }
}

/**
 * Browser only. The key this browser should use once `revokedPublicKey` has
 * been revoked. When the stored key is already a different one (another tab,
 * or the account page, replaced it first) that key is kept and `rotated` is
 * false; only when the revoked key is still the stored one is a new pair made.
 * Checking first keeps two tabs that both learn of the revocation from
 * minting a key each in the common case; the check and the write are separate
 * transactions, so a near-simultaneous pair can still both rotate, which
 * leaves an unused key on the account rather than a browser that cannot sign.
 */
export async function replaceRevokedUserKey(
  revokedPublicKey: string
): Promise<{ key: UserSigningKey; rotated: boolean }> {
  const stored = await getOrCreateUserKey();
  if (stored.publicKey !== revokedPublicKey) return { key: stored, rotated: false };
  return { key: await rotateUserKey(), rotated: true };
}
