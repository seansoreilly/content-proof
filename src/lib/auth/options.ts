import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { isAllowedEmail } from "@/lib/auth/validation";

/**
 * The debug provider signs anyone in without a password. It is gated on a
 * server-only variable AND a non-production build, so no client-exposed
 * setting or misconfigured preview environment can enable it in production.
 */
export const isDebugAuthEnabled: boolean =
  process.env.NODE_ENV !== "production" && process.env.DEBUG_AUTH === "true";

const debugEmail = process.env.DEBUG_AUTH_EMAIL ?? "debug@example.com";

export const authOptions: NextAuthOptions = {
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
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user }) {
      return isAllowedEmail(user.email);
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.allowed = isAllowedEmail(user.email);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.allowed = token.allowed as boolean | undefined;
      }
      return session;
    },
  },
};
