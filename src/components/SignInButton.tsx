"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      onClick={() => {
        // If debug auth is enabled, call the artificial debug provider we register on the server.
        const isDebugAuth =
          process.env.NEXT_PUBLIC_DEBUG_AUTH === "true" ||
          process.env.DEBUG_AUTH === "true";

        if (isDebugAuth) {
          console.log("Debug mode: redirecting to debug auth");
          // Direct redirect to debug auth endpoint
          if (typeof window !== "undefined") {
            window.location.href = "/api/auth/signin/debug";
          }
          return;
        }

        signIn("google");
      }}
      className="btn-primary flex items-center gap-4 px-8 py-4 text-lg group hover:scale-105 transition-all duration-300 shadow-xl"
    >
      {/* Enhanced Google Icon */}
      <div className="relative">
        <svg
          className="w-6 h-6 text-white group-hover:scale-110 transition-transform duration-300"
          viewBox="0 0 24 24"
        >
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>

        {/* Subtle glow effect */}
        <div className="absolute inset-0 w-6 h-6 bg-white/20 rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-pulse transition-opacity duration-300"></div>
      </div>

      <span className="font-semibold tracking-wide">Sign in with Google</span>

      {/* Arrow indicator */}
      <svg
        className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 8l4 4m0 0l-4 4m4-4H3"
        />
      </svg>
    </button>
  );
}
