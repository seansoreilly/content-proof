import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, makeKeyPair, sha256Hex, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64 } from "@/lib/keyset";
import { buildSignedMessage, decodeRecord, encodeRecord, hashHexToB64url, type SignatureRecord } from "@/lib/record";
import { base64ToBytes, bytesToHex, toBase64Url } from "@/lib/base64";
import { createMemoryStore } from "@/lib/rate-limit";
import { createMemoryLogStore } from "@/lib/log-store";
import { recordLeafHash, verifyInclusionProof, verifyLogHead, verifyRecordInclusion, type InclusionProofResponse, type SignedLogHead } from "@/lib/log-verify";
import { parsePublicKeysJson } from "@/lib/keyset";

const session = { user: { email: "signer@gmail.com" } as { email: string } | null };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => (session.user ? { user: session.user } : null)),
}));

// Shared in-memory stores so the sign route and the lookup route see the same data.
const records = new Map<string, SignatureRecord>();
let log = createMemoryLogStore();
vi.mock("@/lib/redis", () => ({
  getCounterStore: () => createMemoryStore(),
  getRecordStore: () => ({
    put: async (r: SignatureRecord) => {
      records.set(r.s, r);
    },
    get: async (s: string) => records.get(s) ?? null,
  }),
  getLogStore: () => log,
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
  return { sign, verify, wellKnown, lookup, logHead, logEntries, logProof };
}

describe("API routes", () => {
  const fileHex = sha256Hex("my file");

  beforeEach(() => {
    records.clear();
    log = createMemoryLogStore();
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
});
