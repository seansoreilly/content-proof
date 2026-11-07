/**
 * Where analytics needs the visitor's opt-in first.
 *
 * The EU and EEA (ePrivacy Directive and GDPR), the UK (PECR and UK GDPR) and
 * Switzerland (revised FADP, read with the ePrivacy-style practice Swiss
 * regulators follow) expect consent before non-essential cookies such as
 * Google Analytics are set. Elsewhere, including Australia where the service
 * is run from, the privacy policy's disclosure is the requirement, so the
 * banner is not shown there.
 *
 * Countries are ISO 3166-1 alpha-2 codes as sent by Vercel in the
 * `x-vercel-ip-country` request header.
 */
export const CONSENT_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  // EU member states
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // Rest of the EEA
  "IS", "LI", "NO",
  // United Kingdom and Switzerland
  "GB", "CH",
]);

/** Header Vercel sets to the visitor's country, derived from their IP address. */
export const COUNTRY_HEADER = "x-vercel-ip-country";

/**
 * True when a visitor from `country` must opt in before analytics loads.
 * An unknown or missing country counts as requiring consent, so a missing
 * header (another host, a proxy, a lookup failure) never skips the banner.
 */
export function consentRequiredFor(country: string | null | undefined): boolean {
  const code = country?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(code)) return true;
  return CONSENT_REQUIRED_COUNTRIES.has(code);
}
