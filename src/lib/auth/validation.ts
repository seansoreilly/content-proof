export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
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
