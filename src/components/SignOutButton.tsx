"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut()}
      className="px-4 py-2 bg-gray-600 text-white rounded"
    >
      Sign out
    </button>
  );
}
