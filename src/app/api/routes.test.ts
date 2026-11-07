import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, makeKeyPair, sha256Hex, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64 } from "@/lib/keyset";
import { buildSignedMessage, decodeRecord, encodeRecord, hashHexToB64url, type SignatureRecord } from "@/lib/record";
import { base64ToBytes, bytesToHex, toBase64Url } from "@/lib/base64";
import { createMemoryStore } from "@/lib/rate-limit";
import { createMemoryLogStore } from "@/lib/log-store";
import { createMemoryRecordStore, type ListByEmailOptions } from "@/lib/record-store";
import { CorruptKeyEntryError, createMemoryUserKeyRegistry, type UserKeyRegistry } from "@/lib/user-key-registry";
import { recordLeafHash, verifyInclusionProof, verifyLogHead, verifyRecordInclusion, type InclusionProofResponse, type SignedLogHead } from "@/lib/log-verify";
import { parsePublicKeysJson } from "@/lib/keyset";
import { createVerificationUrl } from "@/lib/record";
import { stringToBase64Url } from "@/lib/base64";

const session = { user: { email: "signer@gmail.com" } as { email: string } | null };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => (session.user ? { user: session.user } : null)),
}));

// Shared in-memory stores so the sign route and the lookup route see the same data.
const records = new Map<string, SignatureRecord>();
// A real memory store alongside the map, so the account listing sees the same writes.
let recordStore = createMemoryRecordStore();
let log = createMemoryLogStore();
let recordPutError: Error | null = null;
// A real memory registry, so revocation is exercised end to end. Without it a
// missing accessor would throw, be swallowed by the fail-open path, and every
// v3 test would pass without touching the registry.
let userKeys = createMemoryUserKeyRegistry();
let registryError: Error | null = null;
const registry: UserKeyRegistry = {
  lookup: async (publicKey) => {
    if (registryError) throw registryError;
    return userKeys.lookup(publicKey);
  },
  touch: async (email, publicKey, now) => {
    if (registryError) throw registryError;
    return userKeys.touch(email, publicKey, now);
  },
  list: (email) => userKeys.list(email),
  revoke: (email, publicKey, now) => userKeys.revoke(email, publicKey, now),
};
vi.mock("@/lib/redis", () => ({
  getCounterStore: () => createMemoryStore(),
  getRecordStore: () => ({
    put: async (r: SignatureRecord) => {
      if (recordPutError) throw recordPutError;
      records.set(r.s, r);
      await recordStore.put(r);
    },
    get: async (s: string) => records.get(s) ?? null,
    listByEmail: (email: string, options: ListByEmailOptions) => recordStore.listByEmail(email, options),
  }),
  getLogStore: () => log,
  getUserKeyRegistry: () => registry,
}));

async function routes() {
  vi.resetModules();
  const sign = await import("@/app/api/sign/route");
  const verify = await import("@/app/api/verify/route");
  const wellKnown = await import("@/app/.well-known/public-keys.json/route");
  const lookup = await import("@/app/api/sig/[signature]/route");
  const logHead = await import("@/app/api/log/head/route");
  const logEntries = await import("@/app/api/log/entries/route");
  const logProof = await import("@/app/api/log/proof/route");
  const accountRecords = await import("@/app/api/account/records/route");
  const accountKeys = await import("@/app/api/account/keys/route");
  const revokeKey = await import("@/app/api/account/keys/revoke/route");
  const userKeyStatus = await import("@/app/api/keys/user/[key]/route");
  return { sign, verify, wellKnown, lookup, logHead, logEntries, logProof, accountRecords, accountKeys, revokeKey, userKeyStatus };
}

describe("API routes", () => {
  const fileHex = sha256Hex("my file");

  beforeEach(() => {
    records.clear();
    recordStore = createMemoryRecordStore();
    log = createMemoryLogStore();
    recordPutError = null;
    userKeys = createMemoryUserKeyRegistry();
    registryError = null;
    session.user = { email: "signer@gmail.com" };
    stubServerKeys();
  });

  it("appends every issued record to the transparency log and proves inclusion", async () => {
    const { sign, wellKnown, logHead, logEntries, logProof } = await routes();
    const issued: SignatureRecord[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: sha256Hex(`file ${i}`) }));
      const body = (await res.json()) as { record: SignatureRecord; logIndex: number };
      expect(body.logIndex).toBe(i);
      issued.push(body.record);
    }

    const keys = parsePublicKeysJson(await (await wellKnown.GET()).json())!;
    const head = (await (await logHead.GET(new Request("http://t/api/log/head"))).json()) as SignedLogHead;
    expect(head.size).toBe(4);
    expect(verifyLogHead(head, keys)).toBe(true);

    const pageRes = await logEntries.GET(new Request("http://t/api/log/entries?from=1&limit=2"));
    const page = (await pageRes.json()) as {
      from: number;
      limit: number;
      size: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(page).toMatchObject({ from: 1, limit: 2, size: 4 });
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0]).toEqual({
      index: 1,
      leafHash: bytesToHex(recordLeafHash(issued[1])),
      h: issued[1].h,
      t: issued[1].t,
      k: issued[1].k,
      v: issued[1].v,
    });
    // No emails, user keys or signatures anywhere in the public feed
    const raw = JSON.stringify(page);
    expect(raw).not.toContain("signer@gmail.com");
    expect(raw).not.toContain(issued[1].s);

    const byIndex = (await (await logProof.GET(new Request("http://t/api/log/proof?index=2"))).json()) as InclusionProofResponse;
    expect(byIndex.root).toBe(byIndex.head.root);
    expect(byIndex.head.size).toBe(4);
    expect(byIndex).not.toHaveProperty("leaf");
    expect(verifyRecordInclusion(issued[2], byIndex)).toBe(true);
    expect(verifyRecordInclusion(issued[1], byIndex)).toBe(false);
    expect(verifyInclusionProof(issued[2], byIndex, keys)).toBe(true);
    expect(verifyInclusionProof(issued[1], byIndex, keys)).toBe(false);

    const bySig = await logProof.GET(new Request(`http://t/api/log/proof?signature=${issued[3].s}`));
    expect(verifyInclusionProof(issued[3], (await bySig.json()) as InclusionProofResponse, keys)).toBe(true);

    expect((await logProof.GET(new Request(`http://t/api/log/proof?signature=${"Q".repeat(86)}`))).status).toBe(404);
    expect((await logProof.GET(new Request("http://t/api/log/proof"))).status).toBe(400);
    expect((await logEntries.GET(new Request("http://t/api/log/entries?from=-1"))).status).toBe(400);
  });

  it("parses log query strings strictly and echoes the effective limit", async () => {
    const { logEntries, logProof } = await routes();
    const entries = async (qs: string): Promise<Response> => logEntries.GET(new Request(`http://t/api/log/entries${qs}`));
    for (const bad of ["?from=", "?from=%20", "?from=0x10", "?from=1e9", "?from=-1", "?from=abc", "?limit=0", "?limit=", "?limit=1.5"]) {
      const res = await entries(bad);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    expect(await (await entries("")).json()).toMatchObject({ from: 0, limit: 100, entries: [] });
    expect(await (await entries("?limit=99999")).json()).toMatchObject({ limit: 500 });

    const proof = async (qs: string): Promise<Response> => logProof.GET(new Request(`http://t/api/log/proof${qs}`));
    for (const bad of ["?index=", "?index=%20", "?index=0x10", "?index=1e9", "?index=-1", "?index=abc"]) {
      expect((await proof(bad)).status, bad).toBe(400);
    }
    const both = await proof(`?index=0&signature=${"Q".repeat(86)}`);
    expect(both.status).toBe(400);
    expect(await both.json()).toEqual({ error: "Provide index or signature, not both" });
  });

  it("rate limits the log endpoints per client IP with rate-limit headers", async () => {
    const { logHead, logEntries, logProof } = await routes();
    const hit = (fn: (r: Request) => Promise<Response>, path: string, ip: string): Promise<Response> =>
      fn(new Request(`http://t${path}`, { headers: { "x-forwarded-for": ip } }));

    const cases: Array<[(r: Request) => Promise<Response>, string, number]> = [
      [logHead.GET, "/api/log/head", 60],
      [logProof.GET, "/api/log/proof?index=0", 60],
      [logEntries.GET, "/api/log/entries", 30],
    ];
    for (const [fn, path, limit] of cases) {
      for (let i = 0; i < limit; i++) expect((await hit(fn, path, "198.51.100.1")).status, path).not.toBe(429);
      const blocked = await hit(fn, path, "198.51.100.1");
      expect(blocked.status, path).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("60");
      expect(blocked.headers.get("x-ratelimit-limit")).toBe(String(limit));
      expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(blocked.headers.get("access-control-allow-origin")).toBe("*");
      expect(await blocked.json()).toEqual({ error: "Too many requests" });
      // another client is unaffected
      expect((await hit(fn, path, "198.51.100.2")).status, path).not.toBe(429);
    }
  });

  it("serves CORS on success and error responses and answers preflight", async () => {
    const { verify, lookup, logHead, logEntries, logProof, wellKnown } = await routes();
    const cors = (res: Response): string | null => res.headers.get("access-control-allow-origin");

    expect(cors(await verify.POST(jsonRequest("http://t/api/verify", { nope: 1 })))).toBe("*");
    expect(cors(await verify.POST(new Request("http://t/api/verify", { method: "POST", body: "not json" })))).toBe("*");
    expect(cors(await lookup.GET(new Request("http://t"), { params: Promise.resolve({ signature: "bad" }) }))).toBe("*");
    expect(cors(await lookup.GET(new Request("http://t"), { params: Promise.resolve({ signature: "A".repeat(86) }) }))).toBe("*");
    expect(cors(await logHead.GET(new Request("http://t/api/log/head")))).toBe("*");
    expect(cors(await logEntries.GET(new Request("http://t/api/log/entries?from=-1")))).toBe("*");
    expect(cors(await logProof.GET(new Request("http://t/api/log/proof")))).toBe("*");
    expect(cors(await logProof.GET(new Request("http://t/api/log/proof?index=9")))).toBe("*");
    expect(cors(await wellKnown.GET())).toBe("*");

    for (const handler of [verify.OPTIONS, lookup.OPTIONS, logHead.OPTIONS, logEntries.OPTIONS, logProof.OPTIONS, wellKnown.OPTIONS]) {
      const res = handler();
      expect(res.status).toBe(204);
      expect(cors(res)).toBe("*");
      expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
      expect(res.headers.get("access-control-max-age")).toBe("86400");
    }
  });

  it("does not add CORS to the same-origin sign endpoint", async () => {
    const { sign } = await routes();
    const res = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect("OPTIONS" in sign).toBe(false);
  });

  it("returns a JSON 404 for unknown API paths on every method", async () => {
    const catchAll = await import("@/app/api/[...rest]/route");
    for (const handler of [catchAll.GET, catchAll.POST, catchAll.PUT, catchAll.PATCH, catchAll.DELETE, catchAll.OPTIONS]) {
      const res = handler();
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "Not found" });
    }
  });

  it("refuses a service key (current or previous) as the user key", async () => {
    const previous = makeKeyPair();
    vi.stubEnv("ED25519_PUBLIC_KEYS_PREVIOUS", previous.publicKeyBase64);
    const { sign } = await routes();
    const rawOf = (spkiBase64: string): string => toBase64Url(base64ToBytes(spkiBase64).slice(-32));
    const timestamp = Date.now();
    for (const spki of [process.env.ED25519_PUBLIC_KEY ?? "", previous.publicKeyBase64]) {
      const res = await sign.POST(
        jsonRequest("http://t/api/sign", {
          fileHash: fileHex,
          timestamp,
          userPublicKey: rawOf(spki),
          userSignature: "A".repeat(86),
        })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "User key must not be a service key" });
    }
    expect(await log.size()).toBe(0);
  });

  it("rejects string-typed t and v in a JSON verify body but still decodes the wire format", async () => {
    const { sign, verify } = await routes();
    const { record } = (await (await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }))).json()) as {
      record: SignatureRecord;
    };
    expect((await verify.POST(jsonRequest("http://t/api/verify", { ...record, t: String(record.t) }))).status).toBe(400);
    expect((await verify.POST(jsonRequest("http://t/api/verify", { ...record, v: "2" }))).status).toBe(400);
    expect((await verify.POST(jsonRequest("http://t/api/verify", record))).status).toBe(200);
    expect(decodeRecord(encodeRecord(record))).toEqual(record);
  });

  it("signs a hash for the logged-in user and returns a v2 record", async () => {
    const { sign } = await routes();
    const res = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record: SignatureRecord };
    expect(body.record).toMatchObject({ v: 2, e: "signer@gmail.com", h: hashHexToB64url(fileHex) });
    expect(body.record.s).toHaveLength(86);
    expect(records.get(body.record.s)).toEqual(body.record);
  });

  it("reports a stored, logged record with logged: true", async () => {
    const { sign } = await routes();
    const res = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ logIndex: 0, logged: true });
  });

  it("still signs with 200 but reports logged: false when storage fails", async () => {
    recordPutError = new Error("redis down");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sign, verify } = await routes();
    const res = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record: SignatureRecord; logIndex: number | null; logged: boolean };
    expect(body.logged).toBe(false);
    expect(body.logIndex).toBeNull();
    expect(body.record).toMatchObject({ v: 2, e: "signer@gmail.com", h: hashHexToB64url(fileHex) });
    expect(records.size).toBe(0);
    expect(await log.size()).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("NOT persisted"), recordPutError);
    // The record is self-contained and still verifies.
    expect(await (await verify.POST(jsonRequest("http://t/api/verify", body.record))).json()).toMatchObject({ valid: true });
    error.mockRestore();
  });

  it("countersigns a browser-held key's signature into a v3 record and verifies it", async () => {
    const { sign, verify } = await routes();
    const { generateUserKeyPair, toUserSigningKey } = await import("@/lib/user-keys");
    const key = await toUserSigningKey(await generateUserKeyPair());
    const timestamp = Date.now();
    const userSignature = await key.sign(buildSignedMessage(fileHex, "signer@gmail.com", timestamp));

    const res = await sign.POST(
      jsonRequest("http://t/api/sign", { fileHash: fileHex, timestamp, userPublicKey: key.publicKey, userSignature })
    );
    expect(res.status).toBe(200);
    const { record } = (await res.json()) as { record: SignatureRecord };
    expect(record).toMatchObject({ v: 3, u: key.publicKey, us: userSignature, t: timestamp });

    const verified = await (await verify.POST(jsonRequest("http://t/api/verify", record))).json();
    expect(verified).toMatchObject({ valid: true, userSigned: true, userKey: key.publicKey });

    // wrong email in the user signature → service refuses to countersign
    const wrong = await key.sign(buildSignedMessage(fileHex, "other@gmail.com", timestamp));
    const bad = await sign.POST(
      jsonRequest("http://t/api/sign", { fileHash: fileHex, timestamp, userPublicKey: key.publicKey, userSignature: wrong })
    );
    expect(bad.status).toBe(400);

    // timestamp outside the skew window
    const stale = await sign.POST(
      jsonRequest("http://t/api/sign", {
        fileHash: fileHex,
        timestamp: timestamp - 10 * 60 * 1000,
        userPublicKey: key.publicKey,
        userSignature,
      })
    );
    expect(stale.status).toBe(400);

    // user fields present but malformed
    expect(
      (await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex, timestamp, userPublicKey: "x", userSignature }))).status
    ).toBe(400);
  });

  it("rejects unauthenticated and malformed signing requests", async () => {
    const { sign } = await routes();
    session.user = null;
    expect((await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }))).status).toBe(401);
    session.user = { email: "signer@gmail.com" };
    expect((await sign.POST(jsonRequest("http://t/api/sign", { fileHash: "zz" }))).status).toBe(400);
  });

  it("rate limits signing per user", async () => {
    const { sign } = await routes();
    let last = 0;
    for (let i = 0; i < 40; i++) {
      last = (await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }))).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it("verifies a genuine record server-side for any email domain", async () => {
    const { sign, verify } = await routes();
    const signed = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));
    const { record } = (await signed.json()) as { record: SignatureRecord };

    const res = await verify.POST(jsonRequest("http://t/api/verify", record));
    expect(await res.json()).toMatchObject({ valid: true, keyId: record.k });

    session.user = { email: "person@workspace-company.com" };
    const signed2 = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));
    const { record: record2 } = (await signed2.json()) as { record: SignatureRecord };
    expect(await (await verify.POST(jsonRequest("http://t/api/verify", record2))).json()).toMatchObject({
      valid: true,
    });
  });

  it("refuses a forged record signed with an unpublished key", async () => {
    const { verify } = await routes();
    const rogue = makeKeyPair();
    const t = Date.now();
    const forged: SignatureRecord = {
      v: 2,
      k: keyIdFromSpkiBase64(rogue.publicKeyBase64),
      h: hashHexToB64url(fileHex),
      e: "ceo@gmail.com",
      t,
      s: rogue.signHex(buildSignedMessage(fileHex, "ceo@gmail.com", t)),
    };
    const res = await verify.POST(jsonRequest("http://t/api/verify", forged));
    expect(await res.json()).toMatchObject({ valid: false, reason: "unknown-key" });
  });

  it("rejects a malformed verify body", async () => {
    const { verify } = await routes();
    expect((await verify.POST(jsonRequest("http://t/api/verify", { nope: 1 }))).status).toBe(400);
  });

  it("publishes keys by id with CORS and no-cache headers", async () => {
    const { wellKnown } = await routes();
    const res = await wellKnown.GET();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as { current: string; keys: Record<string, { publicKey: string }> };
    expect(body.keys[body.current]?.publicKey).toBe(process.env.ED25519_PUBLIC_KEY);
  });

  it("looks up a stored record by signature and 404s otherwise", async () => {
    const { sign, lookup } = await routes();
    const signed = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));
    const { record } = (await signed.json()) as { record: SignatureRecord };

    const found = await lookup.GET(new Request("http://t"), {
      params: Promise.resolve({ signature: record.s }),
    });
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(record);

    const missing = await lookup.GET(new Request("http://t"), {
      params: Promise.resolve({ signature: "A".repeat(86) }),
    });
    expect(missing.status).toBe(404);
  });

  describe("GET /api/account/records", () => {
    type ListBody = { records: Array<{ record: SignatureRecord; logIndex?: number }>; nextCursor: string | null };
    const list = async (
      accountRecords: { GET: (r: Request) => Promise<Response> },
      qs = ""
    ): Promise<Response> => accountRecords.GET(new Request(`http://t/api/account/records${qs}`));

    it("requires a session and is not CORS-enabled", async () => {
      const { accountRecords } = await routes();
      session.user = null;
      const res = await list(accountRecords);
      expect(res.status).toBe(401);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect("OPTIONS" in accountRecords).toBe(false);
    });

    it("lists only the session account's records, newest first, with log indexes and a cursor", async () => {
      const { sign, accountRecords } = await routes();
      const mine: SignatureRecord[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: sha256Hex(`mine ${i}`) }));
        mine.push(((await res.json()) as { record: SignatureRecord }).record);
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      session.user = { email: "other@gmail.com" };
      await sign.POST(jsonRequest("http://t/api/sign", { fileHash: sha256Hex("theirs") }));

      session.user = { email: "Signer@Gmail.com" };
      const first = await list(accountRecords, "?limit=2");
      expect(first.status).toBe(200);
      expect(first.headers.get("access-control-allow-origin")).toBeNull();
      const page1 = (await first.json()) as ListBody;
      expect(page1.records).toEqual([
        { record: mine[2], logIndex: 2 },
        { record: mine[1], logIndex: 1 },
      ]);
      expect(page1.nextCursor).toEqual(expect.any(String));

      const page2 = (await (await list(accountRecords, `?limit=2&cursor=${page1.nextCursor}`)).json()) as ListBody;
      expect(page2).toEqual({ records: [{ record: mine[0], logIndex: 0 }], nextCursor: null });
      expect(JSON.stringify([page1, page2])).not.toContain("other@gmail.com");
    });

    it("rejects a bad limit or cursor", async () => {
      const { accountRecords } = await routes();
      for (const bad of ["?limit=0", "?limit=", "?limit=1.5", "?cursor=nope"]) {
        expect((await list(accountRecords, bad)).status, bad).toBe(400);
      }
      expect(((await (await list(accountRecords, "?limit=9999")).json()) as ListBody).records).toEqual([]);
    });
  });

  describe("user key registry", () => {
    type Key = { publicKey: string; firstSeen: number; lastSeen: number; revokedAt?: number };

    async function browserKey(): Promise<{ publicKey: string; sign: (m: string) => Promise<string> }> {
      const { generateUserKeyPair, toUserSigningKey } = await import("@/lib/user-keys");
      return toUserSigningKey(await generateUserKeyPair());
    }

    async function signV3(
      sign: { POST: (r: Request) => Promise<Response> },
      key: { publicKey: string; sign: (m: string) => Promise<string> },
      email: string,
      file = "file"
    ): Promise<Response> {
      const timestamp = Date.now();
      const fileHash = sha256Hex(file);
      const userSignature = await key.sign(buildSignedMessage(fileHash, email, timestamp));
      return sign.POST(jsonRequest("http://t/api/sign", { fileHash, timestamp, userPublicKey: key.publicKey, userSignature }));
    }

    const revokeRequest = (publicKey: unknown): Request => jsonRequest("http://t/api/account/keys/revoke", { publicKey });

    it("records the key on v3 signing and lists it for the account only", async () => {
      const { sign, accountKeys } = await routes();
      const key = await browserKey();
      expect((await signV3(sign, key, "signer@gmail.com")).status).toBe(200);
      expect((await signV3(sign, key, "signer@gmail.com", "second")).status).toBe(200);
      // v2 signing registers nothing
      await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));

      const res = await accountKeys.GET();
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      const { keys } = (await res.json()) as { keys: Key[] };
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({ publicKey: key.publicKey });
      expect(keys[0].lastSeen).toBeGreaterThanOrEqual(keys[0].firstSeen);
      expect(keys[0].revokedAt).toBeUndefined();

      session.user = { email: "other@gmail.com" };
      expect(await (await accountKeys.GET()).json()).toEqual({ keys: [] });
      session.user = null;
      expect((await accountKeys.GET()).status).toBe(401);
    });

    it("refuses a revoked key with 403 and logs nothing", async () => {
      const { sign, revokeKey, accountKeys } = await routes();
      const key = await browserKey();
      expect((await signV3(sign, key, "signer@gmail.com")).status).toBe(200);
      expect(await log.size()).toBe(1);

      const revoked = await revokeKey.POST(revokeRequest(key.publicKey));
      expect(revoked.status).toBe(200);
      const { key: entry } = (await revoked.json()) as { key: Key };
      expect(entry.revokedAt).toEqual(expect.any(Number));

      const refused = await signV3(sign, key, "signer@gmail.com", "after revocation");
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "This signing key has been revoked" });
      expect(await log.size()).toBe(1);

      // Revocation is permanent and idempotent: revoking again keeps the first time.
      const again = (await (await revokeKey.POST(revokeRequest(key.publicKey))).json()) as { key: Key };
      expect(again.key.revokedAt).toBe(entry.revokedAt);
      const { keys } = (await (await accountKeys.GET()).json()) as { keys: Key[] };
      expect(keys[0].revokedAt).toBe(entry.revokedAt);
    });

    it("refuses a key registered to another account", async () => {
      const { sign } = await routes();
      const key = await browserKey();
      expect((await signV3(sign, key, "signer@gmail.com")).status).toBe(200);

      session.user = { email: "mallory@gmail.com" };
      const res = await signV3(sign, key, "mallory@gmail.com");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "This signing key is registered to another account" });
      expect(await log.size()).toBe(1);

      // The same account in different letter case is still the owner.
      session.user = { email: "Signer@Gmail.com" };
      expect((await signV3(sign, key, "Signer@Gmail.com")).status).toBe(200);
    });

    it("fails open when the registry is unavailable", async () => {
      const { sign } = await routes();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      registryError = new Error("redis down");
      const res = await signV3(sign, await browserKey(), "signer@gmail.com");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ logged: true });
      expect(error).toHaveBeenCalledWith(expect.stringContaining("lookup failed"), registryError);

      // ...but not when the entry exists and is unreadable: it may record a revocation.
      const key = await browserKey();
      registryError = new CorruptKeyEntryError(key.publicKey);
      const refused = await signV3(sign, key, "signer@gmail.com", "corrupt");
      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({ error: "Signing key status unavailable" });
      expect(await log.size()).toBe(1);
      error.mockRestore();
    });

    it("revokes only the session account's own, well-formed keys", async () => {
      const { sign, revokeKey } = await routes();
      const key = await browserKey();
      await signV3(sign, key, "signer@gmail.com");

      expect((await revokeKey.POST(revokeRequest("not-a-key"))).status).toBe(400);
      const badJson = new Request("http://t/api/account/keys/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect((await revokeKey.POST(badJson)).status).toBe(400);
      expect((await revokeKey.POST(revokeRequest((await browserKey()).publicKey))).status).toBe(404);

      session.user = { email: "mallory@gmail.com" };
      expect((await revokeKey.POST(revokeRequest(key.publicKey))).status).toBe(404);
      session.user = null;
      expect((await revokeKey.POST(revokeRequest(key.publicKey))).status).toBe(401);

      session.user = { email: "signer@gmail.com" };
      expect((await signV3(sign, key, "signer@gmail.com", "still fine")).status).toBe(200);
    });

    it("serves public key status with CORS and without the email", async () => {
      const { sign, revokeKey, userKeyStatus } = await routes();
      const status = (key: string, ip = "203.0.113.9"): Promise<Response> =>
        userKeyStatus.GET(new Request(`http://t/api/keys/user/${key}`, { headers: { "x-forwarded-for": ip } }), {
          params: Promise.resolve({ key }),
        });
      const key = await browserKey();

      const unknown = await status(key.publicKey);
      expect(unknown.status).toBe(200);
      expect(unknown.headers.get("access-control-allow-origin")).toBe("*");
      expect(await unknown.json()).toEqual({ publicKey: key.publicKey, known: false, revokedAt: null });

      await signV3(sign, key, "signer@gmail.com");
      expect(await (await status(key.publicKey)).json()).toEqual({ publicKey: key.publicKey, known: true, revokedAt: null });

      await revokeKey.POST(revokeRequest(key.publicKey));
      const revoked = await status(key.publicKey);
      const text = await revoked.text();
      expect(JSON.parse(text)).toEqual({ publicKey: key.publicKey, known: true, revokedAt: expect.any(Number) });
      expect(text).not.toContain("signer@gmail.com");
      expect(text.toLowerCase()).not.toContain("email");

      const bad = await status("nope");
      expect(bad.status).toBe(400);
      expect(bad.headers.get("access-control-allow-origin")).toBe("*");
      expect(userKeyStatus.OPTIONS().status).toBe(204);

      registryError = new Error("redis down");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const down = await status(key.publicKey);
      expect(down.status).toBe(503);
      expect(down.headers.get("access-control-allow-origin")).toBe("*");
      warn.mockRestore();
    });

    it("rate limits the public key status per client IP", async () => {
      const { userKeyStatus } = await routes();
      const key = (await browserKey()).publicKey;
      const hit = (ip: string): Promise<Response> =>
        userKeyStatus.GET(new Request(`http://t/api/keys/user/${key}`, { headers: { "x-forwarded-for": ip } }), {
          params: Promise.resolve({ key }),
        });
      for (let i = 0; i < 60; i++) expect((await hit("198.51.100.7")).status).toBe(200);
      const blocked = await hit("198.51.100.7");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("access-control-allow-origin")).toBe("*");
      expect((await hit("198.51.100.8")).status).toBe(200);
    });
  });
});

describe("POST /api/verify: compact records, links and fileHash", () => {
  const fileHex = sha256Hex("my file");

  beforeEach(() => {
    records.clear();
    log = createMemoryLogStore();
    recordPutError = null;
    session.user = { email: "signer@gmail.com" };
    stubServerKeys();
  });

  async function signed(): Promise<{ verify: Awaited<ReturnType<typeof routes>>["verify"]; record: SignatureRecord }> {
    const { sign, verify } = await routes();
    const res = await sign.POST(jsonRequest("http://t/api/sign", { fileHash: fileHex }));
    const { record } = (await res.json()) as { record: SignatureRecord };
    return { verify, record };
  }

  async function post(
    verify: Awaited<ReturnType<typeof routes>>["verify"],
    body: unknown
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await verify.POST(jsonRequest("http://t/api/verify", body));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it("accepts a compact record string and a full verification link", async () => {
    const { verify, record } = await signed();
    const expected = { valid: true, keyId: record.k, userSigned: false, userKey: null, reason: null };
    expect(await post(verify, { record: encodeRecord(record) })).toEqual({ status: 200, json: expected });
    const url = createVerificationUrl(encodeRecord(record), "https://www.contentproof.app");
    expect(await post(verify, { record: url })).toEqual({ status: 200, json: expected });
    expect(await post(verify, { record: `  <${url}>\n` })).toEqual({ status: 200, json: expected });
  });

  it("verifies against fileHash when given, in either body form", async () => {
    const { verify, record } = await signed();
    const other = sha256Hex("a different file");
    for (const base of [{ record: encodeRecord(record) }, record]) {
      expect(await post(verify, { ...base, fileHash: fileHex })).toMatchObject({ status: 200, json: { valid: true } });
      expect(await post(verify, { ...base, fileHash: fileHex.toUpperCase() })).toMatchObject({
        status: 200,
        json: { valid: true },
      });
      expect(await post(verify, { ...base, fileHash: other })).toEqual({
        status: 200,
        json: { valid: false, keyId: null, userSigned: false, userKey: null, reason: "hash-mismatch" },
      });
    }
  });

  it("still reports a forged compact record as unknown-key even with a matching fileHash", async () => {
    const { verify } = await routes();
    const rogue = makeKeyPair();
    const t = Date.now();
    const forged: SignatureRecord = {
      v: 2,
      k: keyIdFromSpkiBase64(rogue.publicKeyBase64),
      h: hashHexToB64url(fileHex),
      e: "ceo@gmail.com",
      t,
      s: rogue.signHex(buildSignedMessage(fileHex, "ceo@gmail.com", t)),
    };
    expect(await post(verify, { record: encodeRecord(forged), fileHash: fileHex })).toMatchObject({
      status: 200,
      json: { valid: false, reason: "unknown-key" },
    });
  });

  it("returns 400 for an unparseable or legacy record string and a malformed fileHash", async () => {
    const { verify, record } = await signed();
    const garbage = await post(verify, { record: "garbage" });
    expect(garbage.status).toBe(400);
    expect(garbage.json.error).toMatch(/Invalid record/);
    expect((await post(verify, { record: "" })).status).toBe(400);

    const legacy = stringToBase64Url(JSON.stringify({ signature: "x", publicKey: "y", timestamp: 1 }));
    const legacyRes = await post(verify, { record: legacy });
    expect(legacyRes.status).toBe(400);
    expect(legacyRes.json.error).toMatch(/legacy/i);

    for (const fileHash of ["zz", fileHex.slice(1), 42, null]) {
      for (const base of [{ record: encodeRecord(record) }, record]) {
        const res = await post(verify, { ...base, fileHash });
        expect(res.status).toBe(400);
        expect(res.json.error).toMatch(/fileHash/);
      }
    }
    expect((await post(verify, null)).status).toBe(400);
    expect((await post(verify, { record: 5 })).status).toBe(400);
    const huge = await post(verify, { record: `${encodeRecord(record)}${" ".repeat(5000)}` });
    expect(huge.status).toBe(400);
    expect(huge.json.error).toMatch(/Longer than/);
  });
});
