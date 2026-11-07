import { timingSafeEqual } from "node:crypto";
import { parsePublicKeysJson } from "@/lib/keyset";
import productionKeys from "@/lib/production-keys.json";

/**
 * A password login for automated end-to-end tests on Vercel preview
 * deployments, where Google sign-in cannot be scripted.
 *
 * This is a notary: a session signs real attestations. So the login only
 * works when every one of these holds, checked again on every attempt:
 *
 *  - the deployment is a Vercel preview (`VERCEL_ENV === "preview"`; previews
 *    run with `NODE_ENV=production`, so that cannot be the test);
 *  - `PREVIEW_TEST_AUTH_SECRET` is set (32+ characters) and the caller presents
 *    it, compared in constant time;
 *  - `PREVIEW_TEST_AUTH_ISOLATED=yes`, the operator's promise that Preview has
 *    its own Redis database and its own NEXTAUTH_SECRET. Code cannot check
 *    either, and both matter: the transparency log is permanent, and a shared
 *    NEXTAUTH_SECRET would let a test session cookie work on production;
 *  - the service signing key is NOT a production key: not in the list
 *    committed with the code, and not in the live production key document
 *    (fetched; if that fetch fails the login is refused);
 *  - the request is not addressed to a production hostname.
 *
 * Test accounts are `<name>@preview.contentproof.test` (a reserved .test
 * domain, RFC 2606), so a test record is recognisable anywhere it turns up.
 * Outside a preview such an address is never allowed and its sessions are
 * dropped (see `options.ts`).
 */
export const PREVIEW_TEST_PROVIDER_ID = "preview-test";
export const PREVIEW_TEST_EMAIL_DOMAIN = "preview.contentproof.test";
export const PRODUCTION_KEYS_URL = "https://www.contentproof.app/.well-known/public-keys.json";
const PRODUCTION_HOSTS = ["www.contentproof.app", "contentproof.app"];
const MIN_SECRET_LENGTH = 32;
const NAME_RE = /^[a-z0-9-]{1,32}$/;
const LIVE_KEYS_TTL_MS = 5 * 60 * 1000;

type Env = Record<string, string | undefined>;

export function isPreviewDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

export function isPreviewTestEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${PREVIEW_TEST_EMAIL_DOMAIN}`);
}

/**
 * Why the preview test login is unavailable in this environment, or null when
 * its static preconditions hold. The per-request checks (production key,
 * host, secret) run in `authorizePreviewTestLogin`.
 */
export function previewTestAuthConfigError(env: Env = process.env): string | null {
  if (!isPreviewDeployment(env)) return "not a Vercel preview deployment";
  if ((env.PREVIEW_TEST_AUTH_SECRET ?? "").length < MIN_SECRET_LENGTH) {
    return `PREVIEW_TEST_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`;
  }
  if (env.PREVIEW_TEST_AUTH_ISOLATED !== "yes") {
    return "PREVIEW_TEST_AUTH_ISOLATED=yes is required (separate Preview Redis and NEXTAUTH_SECRET)";
  }
  return null;
}

/** Production key ids committed with the code. */
export const COMMITTED_PRODUCTION_KEY_IDS: ReadonlySet<string> = new Set(Object.keys(productionKeys.keys));

let liveKeysCache: { ids: ReadonlySet<string>; at: number } | null = null;

/** Test hook: forget the cached live production key ids. */
export function resetProductionKeyCache(): void {
  liveKeysCache = null;
}

/**
 * True when `keyId` is, or might be, a production signing key. Unknown counts
 * as production: a failed or malformed fetch of the live document returns true.
 */
export async function isProductionKeyId(
  keyId: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now()
): Promise<boolean> {
  if (COMMITTED_PRODUCTION_KEY_IDS.has(keyId)) return true;
  if (!liveKeysCache || now - liveKeysCache.at > LIVE_KEYS_TTL_MS) {
    try {
      const res = await fetchImpl(PRODUCTION_KEYS_URL, { cache: "no-store" });
      const doc = res.ok ? parsePublicKeysJson(await res.json()) : null;
      if (!doc) return true;
      liveKeysCache = { ids: new Set(Object.keys(doc.keys)), at: now };
    } catch {
      return true;
    }
  }
  return liveKeysCache.ids.has(keyId);
}

function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PreviewLoginResult =
  | { ok: true; user: { id: string; name: string; email: string } }
  | { ok: false; reason: string };

/** Every check for one login attempt. Never throws. */
export async function authorizePreviewTestLogin(input: {
  credentials: Record<string, string> | undefined;
  host: string | null | undefined;
  signingKeyId: () => string;
  env?: Env;
  fetchImpl?: typeof fetch;
}): Promise<PreviewLoginResult> {
  const env = input.env ?? process.env;
  try {
    const configError = previewTestAuthConfigError(env);
    if (configError) return { ok: false, reason: configError };

    const host = (input.host ?? "").split(":")[0].toLowerCase();
    if (!host || PRODUCTION_HOSTS.includes(host)) return { ok: false, reason: "refused on a production hostname" };

    const secret = input.credentials?.secret ?? "";
    if (!secretsMatch(secret, env.PREVIEW_TEST_AUTH_SECRET ?? "")) return { ok: false, reason: "wrong secret" };

    const name = (input.credentials?.name || "e2e").toLowerCase();
    if (!NAME_RE.test(name)) return { ok: false, reason: "name must be 1-32 of a-z, 0-9 and -" };

    if (await isProductionKeyId(input.signingKeyId(), input.fetchImpl)) {
      return { ok: false, reason: "the signing key is (or may be) a production key; give Preview its own key pair" };
    }

    return { ok: true, user: { id: `preview-test:${name}`, name: `Preview test (${name})`, email: `${name}@${PREVIEW_TEST_EMAIL_DOMAIN}` } };
  } catch {
    return { ok: false, reason: "internal error" };
  }
}
