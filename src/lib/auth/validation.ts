import { isPreviewTestEmail, previewTestAuthConfigError } from "@/lib/auth/preview-test-auth";

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  // Test accounts exist only on a correctly configured preview deployment,
  // whatever ALLOWED_EMAIL_DOMAINS says, and are refused everywhere else.
  if (isPreviewTestEmail(email)) return previewTestAuthConfigError() === null;
  const env = process.env.ALLOWED_EMAIL_DOMAINS;
  if (!env || env.trim() === "") {
    // If not configured, allow all emails (development convenience)
    return true;
  }
  const allowedDomains = env.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (allowedDomains.length === 0) return true;

  const domain = email.split("@").pop()?.toLowerCase();
  return domain ? allowedDomains.includes(domain) : false;
}
