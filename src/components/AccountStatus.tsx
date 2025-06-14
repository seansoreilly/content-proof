"use client";
import { useSession } from "next-auth/react";

export function AccountStatus() {
  const { data: session, status } = useSession();

  if (status !== "authenticated") return null;

  // @ts-ignore - allowed added in next-auth.d.ts augmentation
  const allowed: boolean | undefined = session.user?.allowed;

  if (allowed === false) {
    return (
      <p className="mt-4 text-sm text-red-600">
        Your account is not authorized to access this application. Please
        contact support.
      </p>
    );
  }

  return null;
}
