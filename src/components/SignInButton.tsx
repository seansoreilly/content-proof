"use client";

import type { ReactElement } from "react";
import { getProviders, signIn } from "next-auth/react";
import { Button } from "@/components/ui";

/**
 * Tries the development-only debug provider and reports whether it signed the
 * visitor in. It checks the provider list first because next-auth's signIn
 * navigates to its own sign-in page, rather than resolving with an error, when
 * the provider is not registered; that happens whenever NEXT_PUBLIC_DEBUG_AUTH
 * is set without the server-side DEBUG_AUTH.
 */
async function trySignInWithDebug(): Promise<boolean> {
  try {
    const providers = await getProviders();
    if (!providers || !("debug" in providers)) return false;
    const result = await signIn("debug", { redirect: false });
    return result !== undefined && result.ok && !result.error;
  } catch {
    return false;
  }
}

function signInWithGoogle(callbackUrl: string | undefined): void {
  void signIn("google", callbackUrl ? { callbackUrl } : undefined);
}

export function SignInButton({ callbackUrl }: { callbackUrl?: string }): ReactElement {
  return (
    <Button
      onClick={() => {
        // NEXT_PUBLIC_DEBUG_AUTH only picks which provider the button calls.
        // The server registers the debug provider solely when DEBUG_AUTH=true
        // outside production, so both must be set together; if only this one
        // is set the debug attempt fails and we fall back to Google.
        // Both checks are inlined at build time, so a production bundle never
        // calls the debug provider even if the flag leaks into its environment.
        if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEBUG_AUTH === "true") {
          void trySignInWithDebug().then((signedIn) => {
            if (!signedIn) {
              console.warn(
                "Debug sign-in failed: either DEBUG_AUTH=true is not set on the server, or the sign-in callback rejected DEBUG_AUTH_EMAIL (check ALLOWED_EMAIL_DOMAINS). Falling back to Google.",
              );
              signInWithGoogle(callbackUrl);
              return;
            }
            if (callbackUrl) window.location.assign(callbackUrl);
            else window.location.reload();
          });
          return;
        }

        signInWithGoogle(callbackUrl);
      }}
    >
      {/* Google Icon */}
      <svg
        className="mr-2 h-4 w-4"
        width={16}
        height={16}
        aria-hidden="true"
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
      <span>Sign in with Google</span>
    </Button>
  );
}
