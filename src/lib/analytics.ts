// Google Analytics (GA4) helper for client-side usage.
// Docs: https://developers.google.com/analytics/devguides/collection/ga4
// Safe to import anywhere: it only touches `window` and `document` when an
// event is sent or GA is loaded.
//
// GA is only active on the production hostnames, and only after the visitor
// accepts the consent banner (src/components/ConsentBanner.tsx), so localhost,
// preview deployments and visitors who decline stay out of reports. Elsewhere
// events are logged to the console.

/** Measurement ID used when NEXT_PUBLIC_GA_MEASUREMENT_ID is not set at all. */
export const DEFAULT_GA_TRACKING_ID = "G-SXYXFW00DL";

/**
 * Turns the raw NEXT_PUBLIC_GA_MEASUREMENT_ID into a measurement ID, or null
 * when analytics is switched off. Unset keeps the default ID so the live site
 * keeps reporting; an empty value or "off" disables GA entirely, which is how
 * a fork opts out without editing code.
 */
export function resolveGaTrackingId(raw: string | undefined): string | null {
  // An unset or empty value keeps the default, matching the old `||` fallback,
  // so a deployment with an empty variable does not silently lose analytics.
  const value = raw?.trim() ?? "";
  if (value === "") return DEFAULT_GA_TRACKING_ID;
  if (value.toLowerCase() === "off") return null;
  return value;
}

/**
 * The GA4 measurement ID, or null when analytics is disabled.
 *
 * GA only ever runs on the production hostnames below, and only once the
 * visitor has accepted the consent banner. A fork that does not want GA at all
 * sets NEXT_PUBLIC_GA_MEASUREMENT_ID to "off" (an empty value keeps the default); the banner
 * then never renders and the gtag script is never requested.
 */
export const GA_TRACKING_ID: string | null = resolveGaTrackingId(
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
);

export const PRODUCTION_HOSTNAMES: readonly string[] = [
  "www.contentproof.app",
  "contentproof.app",
];

/** localStorage key holding the visitor's analytics choice. */
export const CONSENT_STORAGE_KEY = "contentproof.analytics-consent.v1";

/**
 * Test-only escape hatch: when this localStorage key is "1" the consent banner
 * renders on any hostname, so end-to-end tests can exercise it on localhost.
 * GA itself still only loads on the production hostnames.
 */
export const FORCE_BANNER_STORAGE_KEY = "contentproof.analytics-consent.force-banner";

export type AnalyticsConsent = "granted" | "denied";

/** The subset of the Web Storage API the consent helpers need. */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Ensure TypeScript knows about the gtag globals. Both are absent until the
// visitor consents on a production host, so callers must check before use.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export type SignFailureType =
  | "empty_file"
  | "file_too_large"
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "invalid_response"
  | "unknown";

/** Event names and their parameters. Keep in sync with GA4 custom dimensions. */
export interface AnalyticsEvents {
  file_selected: { source: "drop" | "picker"; is_image: boolean };
  sign_file: { key_type: "user_key" | "service_only"; is_image: boolean };
  sign_file_failed: { error_type: SignFailureType };
  download_seal: Record<string, never>;
  copy_record: { target: "link" | "record" };
  verify_started: { record_kind: "record" | "legacy" };
  verify_signature: {
    result: "success" | "failure";
    record_kind: "record" | "legacy";
    failure_reason?: string;
  };
}

/** True when the given hostname is a production ContentProof host. */
export function isProductionHost(hostname: string): boolean {
  return PRODUCTION_HOSTNAMES.includes(hostname);
}

/**
 * Reads the stored analytics choice. Storage that is missing, throws (blocked
 * site data, some private modes) or holds anything unexpected counts as no
 * choice, which never loads GA.
 */
export function readConsent(storage: ConsentStorage | null): AnalyticsConsent | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(CONSENT_STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Stores the analytics choice. Returns false when storage is unavailable, in
 * which case the choice only lasts for the current page.
 */
export function writeConsent(storage: ConsentStorage | null, consent: AnalyticsConsent): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CONSENT_STORAGE_KEY, consent);
    return true;
  } catch {
    return false;
  }
}

/** True when the test-only force-banner flag is set. Never throws. */
export function readForceBanner(storage: ConsentStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(FORCE_BANNER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Returns window.localStorage, or null where touching it throws (sandboxed
 * iframes and some privacy settings throw on the property access itself).
 */
export function browserStorage(): ConsentStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Decides whether the consent banner should render: only when GA is enabled,
 * no choice is stored, and the page is on a production host (or the test-only
 * force flag is set).
 */
export function shouldShowConsentBanner(options: {
  trackingId: string | null;
  hostname: string;
  consent: AnalyticsConsent | null;
  forceBanner: boolean;
}): boolean {
  if (options.trackingId === null || options.consent !== null) return false;
  return options.forceBanner || isProductionHost(options.hostname);
}

const GTAG_SCRIPT_ID = "ga-gtag";

/**
 * Injects the gtag script and configures GA. Call only after consent. Does
 * nothing off the production hostnames, when GA is disabled, or when GA is
 * already loaded, so it is safe to call more than once.
 */
export function loadGoogleAnalytics(trackingId: string | null = GA_TRACKING_ID): void {
  if (trackingId === null || typeof window === "undefined") return;
  if (!isProductionHost(window.location.hostname)) return;
  if (document.getElementById(GTAG_SCRIPT_ID)) return;

  const dataLayer = (window.dataLayer = window.dataLayer ?? []);
  // gtag.js expects the Arguments object itself, not an array copy.
  window.gtag = function gtag(): void {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", trackingId);

  const script = document.createElement("script");
  script.id = GTAG_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(trackingId)}`;
  document.head.appendChild(script);
}

/**
 * Sends a custom event to GA4. Off the production hostnames the event is
 * logged to the console instead. On a production host without consent gtag is
 * undefined and the call is a no-op. Never throws.
 */
export function track<K extends keyof AnalyticsEvents>(
  eventName: K,
  params: AnalyticsEvents[K],
): void {
  if (typeof window === "undefined") return;
  if (!isProductionHost(window.location.hostname)) {
    console.log(`[Analytics Event]: ${eventName}`, params);
    return;
  }
  const gtag = window.gtag;
  if (typeof gtag !== "function") return;
  try {
    gtag("event", eventName, params);
  } catch (error) {
    console.error(`[Analytics]: Failed to track event "${eventName}":`, error);
  }
}
