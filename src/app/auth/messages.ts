/** Branded explanation for a NextAuth `error` query value. */
export function authErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
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

/** Only same-site relative paths are honoured; anything else is ignored. */
export function safeCallbackUrl(value: string | string[] | undefined): string | undefined {
  const first = firstParam(value);
  if (!first || !first.startsWith("/") || first.startsWith("//") || first.includes("\\")) return undefined;
  return first;
}
