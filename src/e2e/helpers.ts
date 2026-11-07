import { randomBytes } from "node:crypto";
import { parsePublicKeysJson, type PublicKeysJson } from "@/lib/keyset";
import { buildSignedMessage, parseRecordObject, type SignatureRecord } from "@/lib/record";
import type { UserSigningKey } from "@/lib/user-keys";

/**
 * Shared plumbing for the live-server tests in this folder. They all skip
 * unless E2E_BASE_URL is set, and run unchanged against a local server and a
 * Vercel preview (see README, "End-to-end tests").
 *
 * Two sign-in providers are supported:
 *  - `preview-test` (E2E_AUTH_PROVIDER=preview-test, E2E_AUTH_SECRET=...): any
 *    number of `<name>@preview.contentproof.test` accounts, so tests that need
 *    a second account, or a fresh per-account rate-limit window, can run;
 *  - `debug` (the default, a `next dev` server with DEBUG_AUTH=true): one
 *    fixed account. Tests that need more than one account skip there.
 */
export const base: string | undefined = process.env.E2E_BASE_URL?.replace(/\/+$/, "");
export const provider: string = process.env.E2E_AUTH_PROVIDER ?? "debug";
/** True when the server can sign in several distinct accounts. */
export const multiAccount: boolean = provider === "preview-test";
/** Why a multi-account test was skipped, for its title. */
export const NEEDS_ACCOUNTS = "[needs several accounts: E2E_AUTH_PROVIDER=preview-test]";

const isLocal = base !== undefined && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(base);

/**
 * A per-test-file client address, sent only to a local server. Every limiter
 * keys anonymous traffic on x-forwarded-for (and falls back to one shared
 * "unknown" bucket without it), so the files running in parallel would
 * otherwise share one bucket for the preview login and the public endpoints.
 * Vercel overwrites the header, so on a preview the real address counts and
 * the tests are written to fit its budgets.
 */
let clientIp: string | null = null;
export function setClientIp(lastOctet: number): void {
  clientIp = isLocal ? `203.0.113.${lastOctet}` : null;
}

/** fetch with Vercel's Protection Bypass for Automation header when configured. */
export function api(path: string, init: RequestInit = {}): Promise<Response> {
  const bypass = process.env.E2E_VERCEL_BYPASS;
  const headers = new Headers(init.headers);
  if (bypass) headers.set("x-vercel-protection-bypass", bypass);
  if (clientIp && !headers.has("x-forwarded-for")) headers.set("x-forwarded-for", clientIp);
  const url = path.startsWith("http") ? path : `${base}${path}`;
  return fetch(url, { ...init, headers });
}

export function cookiesFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

export function joinCookies(...parts: string[]): string {
  return parts.filter(Boolean).join("; ");
}

/** next-auth prefixes its cookies with __Secure- on https. */
export function sessionCookieName(): string {
  return base?.startsWith("https:") ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

/**
 * A short random suffix for account names, so a rerun gets fresh accounts
 * (and fresh per-account rate-limit windows) rather than last run's.
 */
export const runId: string = `${Date.now().toString(36).slice(-5)}${randomBytes(2).toString("hex")}`;

/** `<prefix>-<runId>`, a valid preview-test name (a-z, 0-9, -, at most 32). */
export function accountName(prefix: string): string {
  return `${prefix}-${runId}`.slice(0, 32);
}

export interface Account {
  cookie: string;
  email: string;
  /** The raw Set-Cookie headers of the login response, attributes included. */
  setCookies: string[];
}

/** A CSRF token and the cookie that goes with it. */
export async function csrf(): Promise<{ csrfToken: string; cookie: string }> {
  const res = await api("/api/auth/csrf");
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return { csrfToken, cookie: cookiesFrom(res) };
}

const accounts = new Map<string, Account>();

/**
 * Sign in with the configured provider and return the session cookie and the
 * account's email. With `preview-test`, `name` picks the account
 * (`<name>@preview.contentproof.test`); with `debug` there is only one account
 * and naming one is an error, so multi-account tests must skip first.
 *
 * Logins are cached per name for the test file: the preview login is limited
 * to 10 attempts per client address per minute.
 */
export async function login(name?: string): Promise<Account> {
  if (name !== undefined && !multiAccount) {
    throw new Error(`login("${name}") needs E2E_AUTH_PROVIDER=preview-test; the ${provider} provider has one account`);
  }
  const cacheKey = name ?? "";
  const cached = accounts.get(cacheKey);
  if (cached) return cached;

  const { csrfToken, cookie: csrfCookie } = await csrf();
  const form = new URLSearchParams({ csrfToken, json: "true", secret: process.env.E2E_AUTH_SECRET ?? "" });
  if (name !== undefined) form.set("name", name);
  const res = await api(`/api/auth/callback/${provider}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body: form.toString(),
  });
  const cookie = joinCookies(csrfCookie, cookiesFrom(res));
  if (!cookie.includes("session-token")) {
    throw new Error(
      `${provider} login${name ? ` as ${name}` : ""} failed (HTTP ${res.status}): wrong E2E_AUTH_SECRET, the ` +
        "provider is not enabled on this server, or the login rate limit (10/min per address) was hit"
    );
  }
  const session = (await (await api("/api/auth/session", { headers: { cookie } })).json()) as {
    user?: { email?: string };
  };
  const email = session.user?.email;
  if (!email) throw new Error(`${provider} login${name ? ` as ${name}` : ""} gave a session without an email`);
  const account = { cookie, email, setCookies: res.headers.getSetCookie?.() ?? [] };
  accounts.set(cacheKey, account);
  return account;
}

export interface SignResult {
  status: number;
  body: { record?: unknown; logIndex?: number | null; logged?: boolean; error?: string };
  record: SignatureRecord | null;
}

/** POST /api/sign with a JSON body, as the upload page does. */
export async function sign(account: Account | null, body: unknown): Promise<SignResult> {
  const res = await api("/api/sign", {
    method: "POST",
    headers: { "content-type": "application/json", ...(account ? { cookie: account.cookie } : {}) },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as SignResult["body"];
  return { status: res.status, body: parsed, record: parseRecordObject(parsed.record) };
}

/** POST /api/account/keys/revoke for one of the account's keys. */
export function revokeKey(account: Account, publicKey: string): Promise<Response> {
  return api("/api/account/keys/revoke", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: account.cookie },
    body: JSON.stringify({ publicKey }),
  });
}

/** The public revocation status of a user key. */
export async function keyStatus(publicKey: string): Promise<{ known: boolean; revokedAt: number | null }> {
  const res = await api(`/api/keys/user/${publicKey}`);
  if (res.status !== 200) throw new Error(`GET /api/keys/user/${publicKey} answered ${res.status}`);
  return (await res.json()) as { known: boolean; revokedAt: number | null };
}

/** A fresh browser-style user key (the upload page's own implementation). */
export async function makeUserKey(): Promise<UserSigningKey> {
  const { generateUserKeyPair, toUserSigningKey } = await import("@/lib/user-keys");
  return toUserSigningKey(await generateUserKeyPair());
}

/** The body of a version 3 sign request: the user key signs `<hash>:<email>:<t>`. */
export async function v3Body(
  account: Account,
  key: UserSigningKey,
  fileHash: string
): Promise<{ fileHash: string; timestamp: number; userPublicKey: string; userSignature: string }> {
  const timestamp = Date.now();
  const userSignature = await key.sign(buildSignedMessage(fileHash.toLowerCase(), account.email, timestamp));
  return { fileHash, timestamp, userPublicKey: key.publicKey, userSignature };
}

export async function publicKeys(): Promise<PublicKeysJson> {
  const keys = parsePublicKeysJson(await (await api("/.well-known/public-keys.json")).json());
  if (!keys) throw new Error("the server's public key document did not parse");
  return keys;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
