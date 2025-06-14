import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { isAllowedEmail } from "@/lib/auth/validation";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user }) {
      // Allow sign in only for users whose email domain is permitted
      return isAllowedEmail(user.email);
    },
    async jwt({ token, user }) {
      // Persist the evaluation result in the JWT token
      if (user && user.email) {
        token.allowed = isAllowedEmail(user.email);
      }
      return token;
    },
    async session({ session, token }) {
      // Expose the evaluation result to the client session
      if (session.user) {
        // @ts-ignore - augmented in next-auth.d.ts
        session.user.allowed = token.allowed as boolean | undefined;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 