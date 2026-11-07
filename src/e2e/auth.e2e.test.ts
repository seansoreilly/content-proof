import { describe, expect, it } from "vitest";
import { encode } from "next-auth/jwt";
import { sha256Hex } from "@/test/fixtures";
import { verifyRecord } from "@/lib/crypto/verify";
import { hashHexToB64url, type SignatureRecord } from "@/lib/record";
import type { SignedLogHead } from "@/lib/log-verify";
import { USER_KEY_REVOKED_MESSAGE } from "@/lib/user-key-status";
import {
  NEEDS_ACCOUNTS,
  accountName,
  api,
  base,
  cookiesFrom,
  csrf,
  joinCookies,
  keyStatus,
  login,
  makeUserKey,
  multiAccount,
  provider,
  publicKeys,
  revokeKey,
  runId,
  sessionCookieName,
  sign,
  setClientIp,
  v3Body,
  type Account,
} from "@/e2e/helpers";

/**
 * Authentication and authorisation against a live server: what happens
 * without a valid session, CSRF on next-auth's own forms and on the JSON
 * endpoints, isolation between accounts, what the public endpoints reveal,
 * and how oversized or odd input is handled.
 *
 * E2E_NEXTAUTH_SECRET (optional): the server's NEXTAUTH_SECRET, to also mint
 * an expired but otherwise genuine session token. Without it that one case
 * skips; the unit tests in src/app/api/session-auth.test.ts cover it anyway.
 */
setClientIp(12);

const nextAuthSecret = process.env.E2E_NEXTAUTH_SECRET;
const WRONG_SECRET = "not-this-deployment-s-secret-0123456789";
/** A key that is well formed but on no account. */
const STRANGER_KEY = "A".repeat(43);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The account for single-account checks: a fresh one with preview-test, else the debug account. */
const primary = (): Promise<Account> => (multiAccount ? login(accountName("sec-a")) : login());

/** Status of every session-only endpoint when called with `cookie`. */
async function sessionStatuses(cookie: string | null): Promise<Record<string, number>> {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  const json = { ...headers, "content-type": "application/json" };
  const [signRes, records, keys, revoke] = await Promise.all([
    api("/api/sign", { method: "POST", headers: json, body: JSON.stringify({ fileHash: sha256Hex("no session") }) }),
    api("/api/account/records", { headers }),
    api("/api/account/keys", { headers }),
    api("/api/account/keys/revoke", { method: "POST", headers: json, body: JSON.stringify({ publicKey: STRANGER_KEY }) }),
  ]);
  return { sign: signRes.status, records: records.status, keys: keys.status, revoke: revoke.status };
}

const ALL_401 = { sign: 401, records: 401, keys: 401, revoke: 401 };

describe.skipIf(!base)("no valid session", () => {
  it("is 401 everywhere with no cookie or a garbage token under either cookie name", async () => {
    expect(await sessionStatuses(null)).toEqual(ALL_401);
    for (const name of ["next-auth.session-token", "__Secure-next-auth.session-token"]) {
      expect(await sessionStatuses(`${name}=garbage.not-a-jwe`), name).toEqual(ALL_401);
      expect(await sessionStatuses(`${name}=${"A".repeat(400)}`), name).toEqual(ALL_401);
    }
  });

  it("is 401 everywhere for a token encrypted with the wrong secret", async () => {
    const forged = await encode({
      token: { email: "victim@gmail.com", name: "Victim", allowed: true },
      secret: WRONG_SECRET,
    });
    expect(await sessionStatuses(`${sessionCookieName()}=${forged}`)).toEqual(ALL_401);
  });

  it.skipIf(!nextAuthSecret)("is 401 everywhere for an expired token [needs E2E_NEXTAUTH_SECRET]", async () => {
    const claims = { email: "expired@gmail.com", name: "Expired", allowed: true };
    const expired = await encode({ token: claims, secret: nextAuthSecret!, maxAge: -60 });
    expect(await sessionStatuses(`${sessionCookieName()}=${expired}`)).toEqual(ALL_401);
    // Control: the same claims, unexpired, are a session. Proves the secret is right.
    const fresh = await encode({ token: claims, secret: nextAuthSecret!, maxAge: 300 });
    const session = (await (await api("/api/auth/session", { headers: { cookie: `${sessionCookieName()}=${fresh}` } })).json()) as {
      user?: { email?: string };
    };
    expect(session.user?.email).toBe(claims.email);
  });
});

describe.skipIf(!base)("CSRF", () => {
  const sessionUser = async (cookie: string): Promise<string | undefined> => {
    const session = (await (await api("/api/auth/session", { headers: { cookie } })).json()) as { user?: { email?: string } };
    return session.user?.email;
  };

  it("creates no session from a credentials callback without a matching CSRF token", async () => {
    const { csrfToken, cookie: csrfCookie } = await csrf();
    const other = await csrf();
    const credentials = { json: "true", secret: process.env.E2E_AUTH_SECRET ?? "", ...(multiAccount ? { name: accountName("csrf") } : {}) };
    const attempts: Array<[string, string, Record<string, string>]> = [
      ["no token, no cookie", "", credentials],
      ["no token, with cookie", csrfCookie, credentials],
      ["token, no cookie", "", { ...credentials, csrfToken }],
      ["mismatched token", csrfCookie, { ...credentials, csrfToken: other.csrfToken }],
      ["tampered token", csrfCookie, { ...credentials, csrfToken: `${csrfToken.slice(0, -2)}00` }],
    ];
    for (const [label, cookie, form] of attempts) {
      const res = await api(`/api/auth/callback/${provider}`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams(form).toString(),
      });
      const set = cookiesFrom(res);
      expect(set, label).not.toMatch(/session-token=[^;]/);
      // next-auth answers a failed CSRF check by sending the browser back to sign in.
      const location = res.headers.get("location") ?? ((await res.json().catch(() => ({}))) as { url?: string }).url ?? "";
      expect(location, label).toContain("csrf=true");
      expect(await sessionUser(joinCookies(cookie, set)), label).toBeUndefined();
    }
  });

  it("does not sign out without a CSRF token", async () => {
    const account = await primary();
    for (const body of [new URLSearchParams({ json: "true" }), new URLSearchParams({ json: "true", csrfToken: "x".repeat(64) })]) {
      const res = await api("/api/auth/signout", {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: account.cookie },
        body: body.toString(),
      });
      const cleared = (res.headers.getSetCookie?.() ?? []).filter((c) => /session-token=;|session-token=.*Max-Age=0/i.test(c));
      expect(cleared).toEqual([]);
    }
    expect(await sessionUser(account.cookie)).toBe(account.email);
    expect((await api("/api/account/keys", { headers: { cookie: account.cookie } })).status).toBe(200);
  });

  it("issues the session cookie HttpOnly and SameSite=Lax", async () => {
    const account = await primary();
    const sessionCookie = account.setCookies.find((c) => /session-token=/.test(c));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/;\s*HttpOnly/i);
    expect(sessionCookie).toMatch(/;\s*SameSite=Lax/i);
    if (base!.startsWith("https:")) expect(sessionCookie).toMatch(/;\s*Secure/i);
  });

  it("refuses the body shapes a cross-site form can send to the JSON endpoints, with 415", async () => {
    // A cross-site page cannot send application/json without a CORS
    // preflight, which these same-origin endpoints never answer. Together
    // with the SameSite=Lax cookie, that is the CSRF protection.
    const account = await primary();
    const signJson = JSON.stringify({ fileHash: sha256Hex(`csrf ${runId}`) });
    const multipart = new FormData();
    multipart.set(signJson, "");
    const shapes: Array<[string, BodyInit, Record<string, string>]> = [
      ["text/plain", signJson, { "content-type": "text/plain" }],
      ["form-urlencoded", signJson, { "content-type": "application/x-www-form-urlencoded" }],
      ["form fields", `fileHash=${sha256Hex("csrf")}`, { "content-type": "application/x-www-form-urlencoded" }],
      ["multipart", multipart, {}],
    ];
    for (const [label, body, headers] of shapes) {
      for (const path of ["/api/sign", "/api/account/keys/revoke"]) {
        const res = await api(path, { method: "POST", headers: { ...headers, cookie: account.cookie }, body });
        expect(res.status, `${path} ${label}`).toBe(415);
      }
    }
  });
});

describe.skipIf(!base)("public endpoints reveal no email address", () => {
  it("after signing, no public response body contains one", async () => {
    const account = await primary();
    const key = await makeUserKey();
    const signed = await sign(account, await v3Body(account, key, sha256Hex(`privacy ${runId}`)));
    expect(signed.status, signed.body.error).toBe(200);
    const record = signed.record!;
    const logIndex = signed.body.logIndex!;

    const head = (await (await api("/api/log/head")).json()) as SignedLogHead;
    const from = Math.max(0, logIndex - 20);
    const paths = [
      "/api/log/head",
      `/api/log/entries?from=${from}&limit=${logIndex - from + 1}`,
      `/api/log/proof?signature=${encodeURIComponent(record.s)}`,
      `/api/log/proof?index=${logIndex}`,
      `/api/log/consistency?from=${Math.max(1, head.size - 1)}`,
      `/api/keys/user/${key.publicKey}`,
      "/api/health",
      "/api/consent-region",
    ];
    for (const path of paths) {
      const res = await api(path);
      expect(res.status, path).toBe(200);
      const text = await res.text();
      expect(text.toLowerCase(), path).not.toContain(account.email.toLowerCase());
      expect(text, path).not.toMatch(EMAIL_RE);
      expect(text, path).not.toContain("@");
    }
    // The feed carries this record's entry, just without the email.
    const page = (await (await api(`/api/log/entries?from=${logIndex}&limit=1`)).json()) as { entries: Array<{ h: string }> };
    expect(page.entries[0].h).toBe(record.h);
  });
});

describe.skipIf(!base)("cross-account isolation", () => {
  it.skipIf(!multiAccount)(`keeps one account's keys and records away from another ${NEEDS_ACCOUNTS}`, async () => {
    const [alice, bob] = await Promise.all([login(accountName("sec-a")), login(accountName("sec-b"))]);
    expect(alice.email).not.toBe(bob.email);

    const aliceKey = await makeUserKey();
    const aliceV3 = await sign(alice, await v3Body(alice, aliceKey, sha256Hex(`alice v3 ${runId}`)));
    const aliceV2 = await sign(alice, { fileHash: sha256Hex(`alice v2 ${runId}`) });
    const bobV2 = await sign(bob, { fileHash: sha256Hex(`bob v2 ${runId}`) });
    for (const r of [aliceV3, aliceV2, bobV2]) expect(r.status, r.body.error).toBe(200);
    const aliceSignatures = new Set([aliceV3.record!.s, aliceV2.record!.s]);

    // Bob cannot revoke Alice's key, and trying leaves it unrevoked.
    const revoke = await revokeKey(bob, aliceKey.publicKey);
    expect(revoke.status).toBe(404);
    const status = await keyStatus(aliceKey.publicKey);
    expect(status).toMatchObject({ known: true, revokedAt: null });

    // Bob's history and key list are Bob's alone.
    const bobRecords = (await (await api("/api/account/records?limit=50", { headers: { cookie: bob.cookie } })).json()) as {
      records: Array<{ record: SignatureRecord }>;
    };
    expect(bobRecords.records.map((r) => r.record.s)).toContain(bobV2.record!.s);
    for (const { record } of bobRecords.records) {
      expect(aliceSignatures.has(record.s)).toBe(false);
      expect(record.e).toBe(bob.email);
    }
    const bobKeys = (await (await api("/api/account/keys", { headers: { cookie: bob.cookie } })).json()) as {
      keys: Array<{ publicKey: string }>;
    };
    expect(bobKeys.keys.map((k) => k.publicKey)).not.toContain(aliceKey.publicKey);

    // Control: Alice sees her own.
    const aliceRecords = (await (await api("/api/account/records?limit=50", { headers: { cookie: alice.cookie } })).json()) as {
      records: Array<{ record: SignatureRecord }>;
    };
    expect(aliceRecords.records.map((r) => r.record.s)).toEqual(expect.arrayContaining([...aliceSignatures]));

    // Bob holding Alice's private key still cannot sign under his account with it.
    const stolen = await sign(bob, await v3Body(bob, aliceKey, sha256Hex(`bob with alice's key ${runId}`)));
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toBe("This signing key is registered to another account");
    expect(stolen.body.error).not.toBe(USER_KEY_REVOKED_MESSAGE);
  }, 60_000);
});

describe.skipIf(!base)("input limits", () => {
  const TWO_MB = 2 * 1024 * 1024;
  const timeout = (): AbortSignal => AbortSignal.timeout(20_000);

  it("refuses 2 MB bodies with a 4xx, promptly, on sign and verify", async () => {
    const account = await primary();
    const json = { "content-type": "application/json" };
    const validButHuge = JSON.stringify({ fileHash: sha256Hex("huge"), pad: "x".repeat(TWO_MB) });
    const signRes = await api("/api/sign", {
      method: "POST",
      headers: { ...json, cookie: account.cookie },
      body: validButHuge,
      signal: timeout(),
    });
    expect(signRes.status).toBe(413);

    for (const body of [validButHuge, "x".repeat(TWO_MB)]) {
      const res = await api("/api/verify", { method: "POST", headers: json, body, signal: timeout() });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  }, 60_000);

  it("validates fileHash as documented: 64 hex characters, either case", async () => {
    const account = await primary();
    const hex = sha256Hex(`case ${runId}`);
    // Wrong length or alphabet: 400 with the documented message.
    for (const fileHash of [hex.slice(0, 63), `${hex.slice(0, 63)}g`]) {
      const r = await sign(account, { fileHash });
      expect(r.status, fileHash).toBe(400);
      expect(r.body.error).toBe("Invalid fileHash");
    }

    // Uppercase is accepted and normalised: the record carries the lowercase digest.
    const upper = await sign(account, { fileHash: hex.toUpperCase() });
    expect(upper.status, upper.body.error).toBe(200);
    expect(upper.record!.h).toBe(hashHexToB64url(hex));
    const keys = await publicKeys();
    expect(verifyRecord(upper.record!, hex, keys).ok).toBe(true);
    expect(verifyRecord(upper.record!, hex.toUpperCase(), keys).ok).toBe(true);

    // Version 3: the user signs `<lowercase hash>:<email>:<t>` whatever case was sent.
    const key = await makeUserKey();
    const v3 = await sign(account, { ...(await v3Body(account, key, hex)), fileHash: hex.toUpperCase() });
    expect(v3.status, v3.body.error).toBe(200);
    expect(v3.record!.h).toBe(hashHexToB64url(hex));

    // Server-side verify accepts the file hash in either case too.
    const verified = await api("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...upper.record, fileHash: hex.toUpperCase() }),
    });
    expect(await verified.json()).toMatchObject({ valid: true });
  });
});
