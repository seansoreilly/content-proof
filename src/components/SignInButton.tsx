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
          void signIn("debug", { redirect: false }).then(() => {
            window.location.reload();
          });
          return;
        }

        signIn("google");
      }}
      className="btn-primary flex items-center gap-2"
    >
      <span className="text-white">Sign in with Google</span>
    </button>
  );
}
