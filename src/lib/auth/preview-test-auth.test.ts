import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";
import {
  PREVIEW_TEST_EMAIL_DOMAIN,
  PRODUCTION_KEYS_URL,
  authorizePreviewTestLogin,
  isPreviewTestEmail,
  isProductionKeyId,
  previewTestAuthConfigError,
  resetProductionKeyCache,
} from "@/lib/auth/preview-test-auth";
import { isAllowedEmail } from "@/lib/auth/validation";

const SECRET = "s".repeat(40);
const GOOD_ENV = { VERCEL_ENV: "preview", PREVIEW_TEST_AUTH_SECRET: SECRET, PREVIEW_TEST_AUTH_ISOLATED: "yes" };
const PREVIEW_KEY_ID = "previewKeyId0000";

/** A fetch that serves a live production key document holding `ids`. */
function liveKeys(ids: string[]): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(PRODUCTION_KEYS_URL);
    const keys = Object.fromEntries(
      ids.map((id) => [id, { keyId: id, algorithm: "Ed25519", publicKey: "MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }])
    );
    return new Response(JSON.stringify({ current: ids[0], keys }), { status: 200 });
  }) as unknown as typeof fetch;
}

const attempt = (overrides: Partial<Parameters<typeof authorizePreviewTestLogin>[0]> = {}) =>
  authorizePreviewTestLogin({
    credentials: { secret: SECRET, name: "ci" },
    host: "content-proof-git-x-melbourne-computing.vercel.app",
    signingKeyId: () => PREVIEW_KEY_ID,
    env: GOOD_ENV,
    fetchImpl: liveKeys(["lUbNhADjMh-4BW-K"]),
    ...overrides,
  });

beforeEach(() => resetProductionKeyCache());
afterEach(() => vi.unstubAllEnvs());

describe("previewTestAuthConfigError", () => {
  it("is open only on a preview with a long secret and the isolation promise", () => {
    expect(previewTestAuthConfigError(GOOD_ENV)).toBeNull();
    expect(previewTestAuthConfigError({ ...GOOD_ENV, VERCEL_ENV: "production" })).toMatch(/preview/);
    expect(previewTestAuthConfigError({ ...GOOD_ENV, VERCEL_ENV: undefined })).toMatch(/preview/);
    expect(previewTestAuthConfigError({ ...GOOD_ENV, PREVIEW_TEST_AUTH_SECRET: undefined })).toMatch(/32/);
    expect(previewTestAuthConfigError({ ...GOOD_ENV, PREVIEW_TEST_AUTH_SECRET: "short" })).toMatch(/32/);
    expect(previewTestAuthConfigError({ ...GOOD_ENV, PREVIEW_TEST_AUTH_ISOLATED: undefined })).toMatch(/ISOLATED/);
    expect(previewTestAuthConfigError({ ...GOOD_ENV, PREVIEW_TEST_AUTH_ISOLATED: "true" })).toMatch(/ISOLATED/);
  });
});

describe("isProductionKeyId", () => {
  it("treats committed production keys as production without fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await isProductionKeyId("lUbNhADjMh-4BW-K", fetchImpl)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks the live document for keys rotated in after this build", async () => {
    expect(await isProductionKeyId("rotatedKey000000", liveKeys(["rotatedKey000000"]))).toBe(true);
    resetProductionKeyCache();
    expect(await isProductionKeyId(PREVIEW_KEY_ID, liveKeys(["rotatedKey000000"]))).toBe(false);
  });

  it("fails closed when the live document cannot be had", async () => {
    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await isProductionKeyId(PREVIEW_KEY_ID, down)).toBe(true);
    const error = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await isProductionKeyId(PREVIEW_KEY_ID, error)).toBe(true);
    const junk = vi.fn(async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 })) as unknown as typeof fetch;
    expect(await isProductionKeyId(PREVIEW_KEY_ID, junk)).toBe(true);
  });

  it("caches the live document briefly", async () => {
    const fetchImpl = liveKeys(["rotatedKey000000"]);
    await isProductionKeyId(PREVIEW_KEY_ID, fetchImpl, 1_000);
    await isProductionKeyId(PREVIEW_KEY_ID, fetchImpl, 2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await isProductionKeyId(PREVIEW_KEY_ID, fetchImpl, 1_000 + 6 * 60 * 1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("authorizePreviewTestLogin", () => {
  it("logs in a .test account when every check passes", async () => {
    expect(await attempt()).toEqual({
      ok: true,
      user: { id: "preview-test:ci", name: "Preview test (ci)", email: `ci@${PREVIEW_TEST_EMAIL_DOMAIN}` },
    });
    expect(await attempt({ credentials: { secret: SECRET } })).toMatchObject({ ok: true, user: { email: `e2e@${PREVIEW_TEST_EMAIL_DOMAIN}` } });
  });

  it("refuses outside a preview, or without the secret or the isolation promise", async () => {
    expect(await attempt({ env: { ...GOOD_ENV, VERCEL_ENV: "production" } })).toMatchObject({ ok: false });
    expect(await attempt({ env: { ...GOOD_ENV, PREVIEW_TEST_AUTH_ISOLATED: undefined } })).toMatchObject({ ok: false });
    expect(await attempt({ credentials: { secret: "x".repeat(40) } })).toEqual({ ok: false, reason: "wrong secret" });
    expect(await attempt({ credentials: { secret: SECRET.slice(1) } })).toEqual({ ok: false, reason: "wrong secret" });
    expect(await attempt({ credentials: undefined })).toEqual({ ok: false, reason: "wrong secret" });
  });

  it("refuses on a production hostname, or with no host", async () => {
    for (const host of ["www.contentproof.app", "contentproof.app", "WWW.CONTENTPROOF.APP:443", "", null]) {
      expect(await attempt({ host }), String(host)).toMatchObject({ ok: false });
    }
  });

  it("refuses while the preview signs with a production key, or when that cannot be ruled out", async () => {
    expect(await attempt({ signingKeyId: () => "lUbNhADjMh-4BW-K" })).toMatchObject({ ok: false, reason: expect.stringMatching(/production key/) });
    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await attempt({ fetchImpl: down })).toMatchObject({ ok: false, reason: expect.stringMatching(/production key/) });
    expect(
      await attempt({
        signingKeyId: () => {
          throw new Error("keys not configured");
        },
      })
    ).toEqual({ ok: false, reason: "internal error" });
  });

  it("rejects account names outside a-z, 0-9 and -", async () => {
    for (const name of ["a@b", "x".repeat(33), "dot.name", "sp ace"]) {
      expect(await attempt({ credentials: { secret: SECRET, name } }), name).toMatchObject({ ok: false });
    }
  });
});

describe("test accounts outside a preview", () => {
  it("are never allowed, whatever the domain allow-list says", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPreviewTestEmail(`ci@${PREVIEW_TEST_EMAIL_DOMAIN}`)).toBe(true);
    expect(isAllowedEmail(`ci@${PREVIEW_TEST_EMAIL_DOMAIN}`)).toBe(false);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PREVIEW_TEST_AUTH_SECRET", SECRET);
    vi.stubEnv("PREVIEW_TEST_AUTH_ISOLATED", "yes");
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "gmail.com");
    expect(isAllowedEmail(`ci@${PREVIEW_TEST_EMAIL_DOMAIN}`)).toBe(true);
  });

  it("lose their user in the session callback, so a replayed cookie reads as signed out", async () => {
    type SessionArgs = Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>>[0];
    const load = async (): Promise<NextAuthOptions> => {
      vi.resetModules();
      vi.stubEnv("GOOGLE_CLIENT_ID", "id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
      return (await import("@/lib/auth/options")).authOptions;
    };
    const session = { user: { email: `ci@${PREVIEW_TEST_EMAIL_DOMAIN}` }, expires: "2099-01-01T00:00:00.000Z" };
    const call = async (token: Record<string, unknown>) =>
      (await load()).callbacks!.session!({ session, token } as unknown as SessionArgs);

    vi.stubEnv("VERCEL_ENV", "production");
    expect((await call({ previewTest: true, email: session.user.email })).user).toBeUndefined();
    expect((await call({ email: session.user.email })).user).toBeUndefined();

    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await call({ previewTest: true, email: session.user.email, allowed: true })).user).toMatchObject({
      email: session.user.email,
    });
  });

  it("are not offered as a provider outside a configured preview", async () => {
    const providerIds = async (): Promise<string[]> => {
      vi.resetModules();
      vi.stubEnv("GOOGLE_CLIENT_ID", "id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
      return (await import("@/lib/auth/options")).authOptions.providers.map(
        (p) => (p as { options?: { id?: string } }).options?.id ?? p.id
      );
    };
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PREVIEW_TEST_AUTH_SECRET", SECRET);
    vi.stubEnv("PREVIEW_TEST_AUTH_ISOLATED", "yes");
    expect(await providerIds()).not.toContain("preview-test");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await providerIds()).toContain("preview-test");
  });
});
