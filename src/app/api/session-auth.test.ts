import { beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { jsonRequest, sha256Hex, stubServerKeys } from "@/test/fixtures";
import { createMemoryStore } from "@/lib/rate-limit";
import { createMemoryLogStore } from "@/lib/log-store";
import { createMemoryRecordStore } from "@/lib/record-store";
import { createMemoryUserKeyRegistry } from "@/lib/user-key-registry";
import { MAX_JSON_BODY_BYTES } from "@/lib/json-body";

/**
 * The session routes against next-auth's real session handling: the cookie is
 * decrypted and the `session` callback runs exactly as on the server. Only the
 * transport is swapped. In a route handler `getServerSession(authOptions)`
 * reads the cookies from `next/headers`, which only exists inside a request;
 * here the same call goes through next-auth's (req, res, options) form with a
 * cookie this test controls.
 */
const SECRET = "unit-test-nextauth-secret-0123456789";
const cookies: { current: Record<string, string> } = { current: {} };

vi.mock("next-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-auth")>();
  type Options = NonNullable<Parameters<typeof actual.getServerSession>[2]>;
  return {
    ...actual,
    getServerSession: (options: Options) =>
      actual.getServerSession(
        { headers: { host: "localhost:3000" }, cookies: cookies.current } as never,
        { getHeader() {}, setCookie() {}, setHeader() {} } as never,
        options
      ),
  };
});

let counters = createMemoryStore();
let records = createMemoryRecordStore();
let log = createMemoryLogStore();
let userKeys = createMemoryUserKeyRegistry();
vi.mock("@/lib/redis", () => ({
  getCounterStore: () => counters,
  getRecordStore: () => records,
  getLogStore: () => log,
  getUserKeyRegistry: () => userKeys,
}));

const SESSION_COOKIE = "next-auth.session-token";

async function token(claims: Record<string, unknown>, options: { secret?: string; maxAge?: number } = {}): Promise<string> {
  return encode({ token: claims, secret: options.secret ?? SECRET, maxAge: options.maxAge });
}

async function routes() {
  vi.resetModules();
  return {
    sign: await import("@/app/api/sign/route"),
    verify: await import("@/app/api/verify/route"),
    accountRecords: await import("@/app/api/account/records/route"),
    accountKeys: await import("@/app/api/account/keys/route"),
    revoke: await import("@/app/api/account/keys/revoke/route"),
  };
}

/** Status of every session-only endpoint for the current cookie. */
async function sessionStatuses(): Promise<Record<string, number>> {
  const { sign, accountRecords, accountKeys, revoke } = await routes();
  return {
    sign: (await sign.POST(jsonRequest("http://t/api/sign", { fileHash: sha256Hex("x") }))).status,
    records: (await accountRecords.GET(new Request("http://t/api/account/records"))).status,
    keys: (await accountKeys.GET()).status,
    revoke: (await revoke.POST(jsonRequest("http://t/api/account/keys/revoke", { publicKey: "A".repeat(43) }))).status,
  };
}

const ALL_401 = { sign: 401, records: 401, keys: 401, revoke: 401 };

beforeEach(() => {
  counters = createMemoryStore();
  records = createMemoryRecordStore();
  log = createMemoryLogStore();
  userKeys = createMemoryUserKeyRegistry();
  cookies.current = {};
  stubServerKeys();
  vi.stubEnv("NEXTAUTH_SECRET", SECRET);
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
  vi.stubEnv("VERCEL_ENV", "");
});

describe("session-only routes with no valid session", () => {
  it("serve a genuine session (the control case)", async () => {
    cookies.current = { [SESSION_COOKIE]: await token({ email: "alice@gmail.com", allowed: true }) };
    // revoke: 404, a well-formed key that is not on the account.
    expect(await sessionStatuses()).toEqual({ sign: 200, records: 200, keys: 200, revoke: 404 });
  });

  it("are 401 with no cookie or a garbage token under either cookie name", async () => {
    expect(await sessionStatuses()).toEqual(ALL_401);
    for (const name of [SESSION_COOKIE, `__Secure-${SESSION_COOKIE}`]) {
      cookies.current = { [name]: "garbage.not-a-jwe" };
      expect(await sessionStatuses(), name).toEqual(ALL_401);
    }
  });

  it("are 401 for a token encrypted with the wrong secret", async () => {
    cookies.current = {
      [SESSION_COOKIE]: await token({ email: "alice@gmail.com" }, { secret: "some-other-deployment-secret-000000" }),
    };
    expect(await sessionStatuses()).toEqual(ALL_401);
  });

  it("are 401 for an expired token", async () => {
    cookies.current = { [SESSION_COOKIE]: await token({ email: "alice@gmail.com" }, { maxAge: -60 }) };
    expect(await sessionStatuses()).toEqual(ALL_401);
  });
});

describe("a preview test session replayed outside a preview", () => {
  const previewEnv = (): void => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PREVIEW_TEST_AUTH_SECRET", "p".repeat(40));
    vi.stubEnv("PREVIEW_TEST_AUTH_ISOLATED", "yes");
  };

  it("cannot sign on production, with or without the previewTest marker", async () => {
    const email = "ci@preview.contentproof.test";
    for (const claims of [{ email, previewTest: true }, { email }]) {
      cookies.current = { [SESSION_COOKIE]: await token(claims) };
      vi.stubEnv("VERCEL_ENV", "production");
      expect(await sessionStatuses(), JSON.stringify(claims)).toEqual(ALL_401);
      vi.stubEnv("VERCEL_ENV", "");
      expect(await sessionStatuses(), JSON.stringify(claims)).toEqual(ALL_401);
    }
  });

  it("does sign on a configured preview (the control case)", async () => {
    previewEnv();
    cookies.current = { [SESSION_COOKIE]: await token({ email: "ci@preview.contentproof.test", previewTest: true }) };
    expect((await sessionStatuses()).sign).toBe(200);
  });
});

describe("cross-site request shapes on the session JSON endpoints", () => {
  beforeEach(async () => {
    cookies.current = { [SESSION_COOKIE]: await token({ email: "alice@gmail.com", allowed: true }) };
  });

  // What a cross-site page can send without a CORS preflight.
  const simpleBodies = (json: string): Array<[string, BodyInit, Record<string, string>]> => [
    ["text/plain", json, { "content-type": "text/plain" }],
    ["default (string body)", json, {}],
    ["form-urlencoded", json, { "content-type": "application/x-www-form-urlencoded" }],
    ["multipart", (() => { const f = new FormData(); f.set(json, ""); return f; })(), {}],
  ];

  it("refuses non-JSON content types with 415 and signs nothing", async () => {
    const { sign, revoke } = await routes();
    const signJson = JSON.stringify({ fileHash: sha256Hex("csrf") });
    for (const [label, body, headers] of simpleBodies(signJson)) {
      const res = await sign.POST(new Request("http://t/api/sign", { method: "POST", headers, body }));
      expect(res.status, label).toBe(415);
      expect(await res.json(), label).toEqual({ error: "Content-Type must be application/json" });
    }
    expect(await log.size()).toBe(0);

    const revokeJson = JSON.stringify({ publicKey: "A".repeat(43) });
    for (const [label, body, headers] of simpleBodies(revokeJson)) {
      const res = await revoke.POST(new Request("http://t/api/account/keys/revoke", { method: "POST", headers, body }));
      expect(res.status, label).toBe(415);
    }
  });

  it("does not let refused content types or announced oversized bodies spend the signing budget", async () => {
    const { sign } = await routes();
    for (let i = 0; i < 40; i++) {
      const res = await sign.POST(
        new Request("http://t/api/sign", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })
      );
      expect(res.status).toBe(415);
    }
    for (let i = 0; i < 40; i++) {
      const res = await sign.POST(
        jsonRequest("http://t/api/sign", {}, { headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) } })
      );
      expect(res.status).toBe(413);
    }
    expect((await sign.POST(jsonRequest("http://t/api/sign", { fileHash: sha256Hex("ok") }))).status).toBe(200);
  });

  it("accepts application/json with a charset, as browsers may send it", async () => {
    const { sign } = await routes();
    const res = await sign.POST(
      jsonRequest("http://t/api/sign", { fileHash: sha256Hex("charset") }, {
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    );
    expect(res.status).toBe(200);
  });
});

describe("oversized bodies", () => {
  const huge = (extra: Record<string, unknown>): string =>
    JSON.stringify({ ...extra, pad: "x".repeat(2 * 1024 * 1024) });

  it("are refused with 413 by sign, revoke and verify, even when otherwise valid", async () => {
    cookies.current = { [SESSION_COOKIE]: await token({ email: "alice@gmail.com", allowed: true }) };
    const { sign, revoke, verify } = await routes();
    const json = { "content-type": "application/json" };
    const signRes = await sign.POST(
      new Request("http://t/api/sign", { method: "POST", headers: json, body: huge({ fileHash: sha256Hex("big") }) })
    );
    expect(signRes.status).toBe(413);
    expect(await log.size()).toBe(0);
    const revokeRes = await revoke.POST(
      new Request("http://t/api/account/keys/revoke", { method: "POST", headers: json, body: huge({ publicKey: "A".repeat(43) }) })
    );
    expect(revokeRes.status).toBe(413);
    const verifyRes = await verify.POST(new Request("http://t/api/verify", { method: "POST", headers: json, body: huge({}) }));
    expect(verifyRes.status).toBe(413);
    expect(verifyRes.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("leave room for any genuine body", async () => {
    cookies.current = { [SESSION_COOKIE]: await token({ email: "alice@gmail.com", allowed: true }) };
    const { sign } = await routes();
    const body = JSON.stringify({ fileHash: sha256Hex("pad"), pad: "x".repeat(MAX_JSON_BODY_BYTES - 200) });
    const res = await sign.POST(new Request("http://t/api/sign", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(res.status).toBe(200);
  });
});
