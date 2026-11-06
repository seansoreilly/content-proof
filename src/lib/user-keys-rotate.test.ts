import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyEd25519Raw } from "@/lib/crypto/verify";
import { getOrCreateUserKey, replaceRevokedUserKey, rotateUserKey } from "@/lib/user-keys";

/**
 * Just enough of IndexedDB for the key store: one database, object stores
 * keyed by `id`, get and put. fake-indexeddb is not a dependency, and the
 * point here is the store's contents across calls, not IndexedDB itself.
 */
function fakeIndexedDb(): { factory: IDBFactory; puts: () => number } {
  const stores = new Map<string, Map<string, unknown>>();
  let puts = 0;
  function request<T>(produce: () => T): IDBRequest<T> {
    const req = {} as { result: T; onsuccess?: () => void; onerror?: () => void };
    queueMicrotask(() => {
      req.result = produce();
      req.onsuccess?.();
    });
    return req as unknown as IDBRequest<T>;
  }
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => stores.set(name, new Map()),
    transaction: (name: string) => ({
      objectStore: () => ({
        get: (id: string) => request(() => stores.get(name)!.get(id)),
        put: (value: { id: string }) =>
          request(() => {
            puts += 1;
            stores.get(name)!.set(value.id, value);
            return value.id;
          }),
      }),
    }),
    close: () => {},
  };
  const factory = {
    open: () => {
      const req = {} as { result: unknown; onupgradeneeded?: () => void; onsuccess?: () => void };
      queueMicrotask(() => {
        req.result = db;
        if (stores.size === 0) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, puts: () => puts };
}

describe("rotateUserKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("replaces the stored key, so later lookups return the new one", async () => {
    const idb = fakeIndexedDb();
    vi.stubGlobal("indexedDB", idb.factory);

    const original = await getOrCreateUserKey();
    expect((await getOrCreateUserKey()).publicKey).toBe(original.publicKey);

    const rotated = await rotateUserKey();
    expect(rotated.publicKey).not.toBe(original.publicKey);
    expect((await getOrCreateUserKey()).publicKey).toBe(rotated.publicKey);
    // One record, overwritten in place: the first creation and the rotation.
    expect(idb.puts()).toBe(2);

    const signature = await rotated.sign("message");
    expect(verifyEd25519Raw("message", signature, rotated.publicKey)).toBe(true);
    expect(verifyEd25519Raw("message", signature, original.publicKey)).toBe(false);
  });

  it("replaces a revoked key only while it is still the stored one", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb().factory);
    const original = await getOrCreateUserKey();

    const first = await replaceRevokedUserKey(original.publicKey);
    expect(first.rotated).toBe(true);
    expect(first.key.publicKey).not.toBe(original.publicKey);

    // Another tab learning of the same revocation keeps the replacement.
    const second = await replaceRevokedUserKey(original.publicKey);
    expect(second).toMatchObject({ rotated: false, key: { publicKey: first.key.publicKey } });
    expect((await getOrCreateUserKey()).publicKey).toBe(first.key.publicKey);
  });

  it("throws as getOrCreateUserKey does when the browser cannot hold a key", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(rotateUserKey()).rejects.toThrow("This browser cannot hold a signing key");
    await expect(getOrCreateUserKey()).rejects.toThrow("This browser cannot hold a signing key");
  });
});
