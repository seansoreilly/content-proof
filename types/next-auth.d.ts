import type { DefaultSession, DefaultUser } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

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