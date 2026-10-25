"use client";

import type { ReactElement } from "react";
import { useSession } from "next-auth/react";

export function AccountStatus(): ReactElement | null {
  const { data: session, status } = useSession();

  if (status !== "authenticated") return null;

  const allowed: boolean | undefined = session.user?.allowed;

  if (allowed === false) {
    return (
      <div className="mt-4 bg-paper p-4 shadow-pressed">
        <p className="text-sm font-semibold text-void">
          This account is signed in but not on the allowed list, so it cannot
          sign files.
        </p>
      </div>
    );
  }

  return null;
}
