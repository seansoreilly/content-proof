import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { isAllowedEmail } from "@/lib/auth/validation";
import {
  PREVIEW_TEST_PROVIDER_ID,
  authorizePreviewTestLogin,
  isPreviewDeployment,
  isPreviewTestEmail,
  previewTestAuthConfigError,
} from "@/lib/auth/preview-test-auth";
import { getSigningKeyPair } from "@/lib/keys";
import { createRateLimiter } from "@/lib/rate-limit";
import { getCounterStore } from "@/lib/redis";

/**
 * The debug provider signs anyone in without a password. It is gated on a
 * server-only variable AND a non-production build, so no client-exposed
 * setting or misconfigured preview environment can enable it in production.
 */
export const isDebugAuthEnabled: boolean =
  process.env.NODE_ENV !== "production" && process.env.DEBUG_AUTH === "true";

const debugEmail = process.env.DEBUG_AUTH_EMAIL ?? "debug@example.com";

/** Google's OIDC profile carries `email_verified`; anything else is not trusted. */
function hasVerifiedEmail(profile: unknown): boolean {
  if (typeof profile !== "object" || profile === null || !("email_verified" in profile)) return false;
  return profile.email_verified === true;
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const value = (headers as Record<string, unknown>)[name];
  if (typeof value === "string") return value.split(",")[0].trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

let previewLimiter: ReturnType<typeof createRateLimiter> | null = null;
/** 10 preview test login attempts per IP per minute; created on first use. */
function previewLoginLimiter(): ReturnType<typeof createRateLimiter> {
  previewLimiter ??= createRateLimiter(getCounterStore(), { limit: 10, windowSeconds: 60, prefix: "rl:preview-login" });
  return previewLimiter;
}

export const authOptions: NextAuthOptions = {
  pages: { signIn: "/auth/signin", error: "/auth/error" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    ...(isDebugAuthEnabled
      ? [
          CredentialsProvider({
            id: "debug",
            name: "Debug",
            credentials: {},
            async authorize() {
              return { id: "debug-user", name: "Debug User", email: debugEmail };
            },
          }),
        ]
      : []),
    // Password login for automated tests on Vercel previews only; every
    // safeguard is in preview-test-auth.ts and is re-checked per attempt.
    ...(previewTestAuthConfigError() === null
      ? [
          CredentialsProvider({
            id: PREVIEW_TEST_PROVIDER_ID,
            name: "Preview test login",
            credentials: { secret: { type: "password" }, name: { type: "text" } },
            async authorize(credentials, req) {
              const ip = headerValue(req?.headers, "x-forwarded-for") ?? "unknown";
              if (!(await previewLoginLimiter()(ip)).allowed) {
                console.warn("[auth] preview test login rate limited");
                return null;
              }
              const result = await authorizePreviewTestLogin({
                credentials: credentials as Record<string, string> | undefined,
                host: headerValue(req?.headers, "x-forwarded-host") ?? headerValue(req?.headers, "host"),
                signingKeyId: () => getSigningKeyPair().keyId,
              });
              if (!result.ok) {
                console.warn(`[auth] preview test login refused: ${result.reason}`);
                return null;
              }
              return result.user;
            },
          }),
        ]
      : []),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google" && !hasVerifiedEmail(profile)) return false;
      return isAllowedEmail(user.email);
    },
    async jwt({ token, user, account }) {
      if (user?.email) {
        token.allowed = isAllowedEmail(user.email);
      }
      if (account?.provider === PREVIEW_TEST_PROVIDER_ID) token.previewTest = true;
      return token;
    },
    async session({ session, token }) {
      // A preview test session is worthless anywhere but a preview: even if
      // its cookie is replayed against production (e.g. a shared
      // NEXTAUTH_SECRET), it carries no user and every route treats it as
      // signed out.
      if ((token.previewTest || isPreviewTestEmail(token.email)) && !isPreviewDeployment()) {
        return { ...session, user: undefined };
      }
      if (session.user) {
        session.user.allowed = token.allowed as boolean | undefined;
      }
      return session;
    },
  },
};
