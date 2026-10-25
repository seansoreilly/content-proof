import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";
import { isAllowedEmail } from "@/lib/auth/validation";

async function loadAuthOptions() {
  vi.resetModules();
  vi.stubEnv("GOOGLE_CLIENT_ID", "id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const mod = await import("@/lib/auth/options");
  return mod.authOptions;
}

describe("email allow-list", () => {
  it("allows everything when unconfigured and filters by domain otherwise", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
    expect(isAllowedEmail("a@anywhere.io")).toBe(true);
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "gmail.com, example.org");
    expect(isAllowedEmail("a@gmail.com")).toBe(true);
    expect(isAllowedEmail("a@Example.ORG")).toBe(true);
    expect(isAllowedEmail("a@anywhere.io")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
  });
});

describe("sign-in callback and pages", () => {
  type SignInArgs = Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["signIn"]>>[0];
  const asProfile = (value: unknown): SignInArgs["profile"] => value as SignInArgs["profile"];
  const user = { id: "u", email: "a@gmail.com" };
  const call = async (args: Partial<SignInArgs>): Promise<boolean | string> => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
    const options = await loadAuthOptions();
    return options.callbacks!.signIn!({ user, account: null, ...args } as SignInArgs);
  };

  it("routes sign-in and errors to the app's own pages", async () => {
    const options = await loadAuthOptions();
    expect(options.pages).toEqual({ signIn: "/auth/signin", error: "/auth/error" });
  });

  it("requires a verified Google email", async () => {
    const google = { provider: "google", type: "oauth", providerAccountId: "1" } as const;
    expect(await call({ account: google, profile: asProfile({ email_verified: true }) })).toBe(true);
    expect(await call({ account: google, profile: asProfile({ email_verified: false }) })).toBe(false);
    expect(await call({ account: google, profile: asProfile({ email_verified: "true" }) })).toBe(false);
    expect(await call({ account: google, profile: asProfile({}) })).toBe(false);
    expect(await call({ account: google })).toBe(false);
  });

  it("leaves other providers (debug) unaffected", async () => {
    const debug = { provider: "debug", type: "credentials", providerAccountId: "1" } as const;
    expect(await call({ account: debug })).toBe(true);
  });
});

describe("debug sign-in provider", () => {
  beforeEach(() => {
    vi.stubEnv("DEBUG_AUTH", "");
    vi.stubEnv("NEXT_PUBLIC_DEBUG_AUTH", "");
  });

  it("is absent by default", async () => {
    const options = await loadAuthOptions();
    expect(options.providers.map((p) => p.id)).toEqual(["google"]);
  });

  it("is never registered in production, whatever the env says", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEBUG_AUTH", "true");
    vi.stubEnv("NEXT_PUBLIC_DEBUG_AUTH", "true");
    const options = await loadAuthOptions();
    expect(options.providers.map((p) => p.id)).toEqual(["google"]);
  });

  it("cannot be switched on by the public (client-exposed) variable alone", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEBUG_AUTH", "true");
    const options = await loadAuthOptions();
    expect(options.providers.map((p) => p.id)).toEqual(["google"]);
  });

  it("in development uses a configurable address, not a hard-coded person", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEBUG_AUTH", "true");
    vi.stubEnv("DEBUG_AUTH_EMAIL", "dev@example.com");
    const options = await loadAuthOptions();
    // next-auth v4 keeps the caller's config under `options` until parseProviders runs.
    const debug = options.providers.find((p) => p.type === "credentials") as
      | { options: { id: string; authorize: () => Promise<{ email: string }> } }
      | undefined;
    expect(debug).toBeDefined();
    expect(debug?.options.id).toBe("debug");
    const user = await debug!.options.authorize();
    expect(user.email).toBe("dev@example.com");
  });
});
