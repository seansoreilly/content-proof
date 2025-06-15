"use client";
import { useSession } from "next-auth/react";

export function AccountStatus() {
  const { data: session, status } = useSession();

  if (status !== "authenticated") return null;

  const allowed: boolean | undefined = session.user?.allowed;

  if (allowed === false) {
    return (
      <div className="glass mt-4 p-4 border border-red-400/30 bg-red-400/10">
        <p className="text-sm text-red-400 font-medium">
          Your account is not authorized to access this application. Please
          contact support.
        </p>
      </div>
    );
  }

  return null;
}
