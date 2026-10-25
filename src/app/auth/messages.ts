/** Branded explanation for a NextAuth `error` query value. */
export function authErrorMessage(error: string | undefined): string | null {
  // NextAuth redirects to the error page with `error=undefined` when it has no code.
  if (!error || error === "undefined") return null;
  switch (error) {
    case "AccessDenied":
      return "This Google account isn't permitted to sign in here. ContentProof is limited to approved email domains.";
    case "OAuthCallback":
    case "OAuthSignin":
    case "Callback":
      return "Google sign-in did not complete. Try again.";
    case "Configuration":
      return "Sign-in is misconfigured on the server. Please try again later.";
    default:
      return "Sign-in failed. Try again.";
  }
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Only same-site destinations are honoured: a relative path, or an absolute
 * URL on this deployment's own origin (NextAuth itself redirects to the
 * sign-in page with an absolute callbackUrl). Anything else is ignored.
 */
export function safeCallbackUrl(value: string | string[] | undefined): string | undefined {
  const first = firstParam(value);
  if (!first || first.includes("\\")) return undefined;
  if (first.startsWith("/")) return first.startsWith("//") ? undefined : first;
  try {
    const url = new URL(first);
    const own = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
    if (own && url.origin === own) return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // not a URL
  }
  return undefined;
}
