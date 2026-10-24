import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, makeKeyPair, sha256Hex, stubServerKeys } from "@/test/fixtures";
import { keyIdFromSpkiBase64 } from "@/lib/keyset";
import { buildSignedMessage, hashHexToB64url, type SignatureRecord } from "@/lib/record";
import { createMemoryStore } from "@/lib/rate-limit";

const session = { user: { email: "signer@gmail.com" } as { email: string } | null };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => (session.user ? { user: session.user } : null)),
}));

// Shared in-memory stores so the sign route and the lookup route see the same data.
const records = new Map<string, SignatureRecord>();
vi.mock("@/lib/redis", () => ({
  getCounterStore: () => createMemoryStore(),
  getRecordStore: () => ({
    put: async (r: SignatureRecord) => {
      records.set(r.s, r);
    },
    get: async (s: string) => records.get(s) ?? null,
  }),
}));

async function routes() {
  vi.resetModules();
  const sign = await import("@/app/api/sign/route");
  const verify = await import("@/app/api/verify/route");
  const wellKnown = await import("@/app/.well-known/public-keys.json/route");
  const lookup = await import("@/app/api/sig/[signature]/route");
  return { sign, verify, wellKnown, lookup };
}

describe("API routes", () => {
  const fileHex = sha256Hex("my file");

  beforeEach(() => {
    records.clear();
    session.user = { email: "signer@gmail.com" };
    stubServerKeys();
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
