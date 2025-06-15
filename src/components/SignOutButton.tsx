"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut()}
      className="btn-secondary glass flex items-center gap-2 relative overflow-hidden group transition-all duration-300 hover:scale-105 hover:bg-white/20"
    >
      {/* Sign Out Icon */}
      <svg
        className="w-4 h-4 text-light-600 group-hover:text-accent-blue transition-colors duration-300"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
        />
      </svg>
      <span className="text-light-600 group-hover:text-accent-blue transition-colors duration-300 font-medium">
        Sign out
      </span>

      {/* Subtle hover effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-accent-blue/10 to-accent-purple/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>
    </button>
  );
}
