import NextAuth from "next-auth";
import {
  DefaultSession,
  DefaultUser,
  DefaultJWT,
} from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: {
      allowed?: boolean;
    } & DefaultSession["user"]; 
  }
  interface User extends DefaultUser {
    allowed?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    allowed?: boolean;
  }
}

export {};