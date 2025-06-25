import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { isAllowedEmail } from "@/lib/auth/validation";

const isDebugAuth =
  process.env.DEBUG_AUTH === "true" ||
  process.env.NEXT_PUBLIC_DEBUG_AUTH === "true";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    // When debug auth is enabled, add a simple Credentials provider
    ...(isDebugAuth
      ? [
          CredentialsProvider({
            id: "debug",
            name: "Debug Authentication",
            credentials: {},
            async authorize() {
              // Always return a valid user for debug mode
              return {
                id: "debug-user-123",
                name: "Sean O'Reilly",
                email: "seansoreilly@gmail.com",
              };
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
      // In debug mode, always allow sign-in for the fake user.
      if (isDebugAuth) {
        return true;
      }
      return isAllowedEmail(user.email);
    },
    async jwt({ token, user }) {
      if (isDebugAuth) {
        token.allowed = true;
      } else if (user?.email) {
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
