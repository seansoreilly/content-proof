import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { isAllowedEmail } from "@/lib/auth/validation";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    // When debug auth is enabled, add a Credentials provider that automatically signs in
    ...((process.env.DEBUG_AUTH === "true" || process.env.NEXT_PUBLIC_DEBUG_AUTH === "true")
      ? [
          CredentialsProvider({
            id: "debug",
            name: "Debug",
            credentials: {},
            async authorize() {
              return {
                id: "debug-user",
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
      if (process.env.DEBUG_AUTH === "true" || process.env.NEXT_PUBLIC_DEBUG_AUTH === "true") {
        return true;
      }
      return isAllowedEmail(user.email);
    },
    async jwt({ token, user }) {
      if (process.env.DEBUG_AUTH === "true" || process.env.NEXT_PUBLIC_DEBUG_AUTH === "true") {
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