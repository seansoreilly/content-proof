import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, makeKeyPair, sha256Hex, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64 } from "@/lib/keyset";
import { buildSignedMessage, hashHexToB64url, type SignatureRecord } from "@/lib/record";
import { createMemoryStore } from "@/lib/rate-limit";
import { createMemoryLogStore } from "@/lib/log-store";
import { verifyLogHead, verifyRecordInclusion, type InclusionProofResponse, type SignedLogHead } from "@/lib/log-verify";
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
    const head = (await (await logHead.GET()).json()) as SignedLogHead;
    expect(head.size).toBe(4);
    expect(verifyLogHead(head, keys)).toBe(true);

    const page = (await (await logEntries.GET(new Request("http://t/api/log/entries?from=1&limit=2"))).json()) as {
      size: number;
      entries: string[];
    };
    expect(page.size).toBe(4);
    expect(page.entries).toHaveLength(2);

    const byIndex = (await (await logProof.GET(new Request("http://t/api/log/proof?index=2"))).json()) as InclusionProofResponse;
    expect(byIndex.root).toBe(head.root);
    expect(verifyRecordInclusion(issued[2], byIndex)).toBe(true);
    expect(verifyRecordInclusion(issued[1], byIndex)).toBe(false);

    const bySig = await logProof.GET(new Request(`http://t/api/log/proof?signature=${issued[3].s}`));
    expect(verifyRecordInclusion(issued[3], (await bySig.json()) as InclusionProofResponse)).toBe(true);

    expect((await logProof.GET(new Request(`http://t/api/log/proof?signature=${"Q".repeat(86)}`))).status).toBe(404);
    expect((await logProof.GET(new Request("http://t/api/log/proof"))).status).toBe(400);
    expect((await logEntries.GET(new Request("http://t/api/log/entries?from=-1"))).status).toBe(400);
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
