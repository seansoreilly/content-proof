// Google Analytics (GA4) helper for client-side usage.
// Docs: https://developers.google.com/analytics/devguides/collection/ga4
// Safe to import anywhere: it only touches `window` when an event is sent.
//
// GA is only active on the production hostnames so localhost and preview
// deployments stay out of reports. Elsewhere events are logged to the console.

export const GA_TRACKING_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-SXYXFW00DL";

export const PRODUCTION_HOSTNAMES: readonly string[] = [
  "www.contentproof.app",
  "contentproof.app",
];

// Ensure TypeScript knows about the gtag function on window
declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
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

function shouldSend(): boolean {
  return (
    typeof window !== "undefined" &&
    isProductionHost(window.location.hostname) &&
    typeof window.gtag === "function"
  );
}

/**
 * Sends a custom event to GA4. Off the production hostnames the event is
 * logged to the console instead. Never throws.
 */
export function track<K extends keyof AnalyticsEvents>(
  eventName: K,
  params: AnalyticsEvents[K],
): void {
  if (!shouldSend()) {
    if (typeof window !== "undefined") {
      console.log(`[Analytics Event]: ${eventName}`, params);
    }
    return;
  }
  try {
    window.gtag("event", eventName, params);
  } catch (error) {
    console.error(`[Analytics]: Failed to track event "${eventName}":`, error);
  }
}

/**
 * Inline script for the root layout: defines gtag everywhere (so calls never
 * throw) but only configures GA on the production hostnames.
 */
export function gaInitScript(): string {
  return `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    // Only report production traffic; previews and localhost stay out of GA.
    if (${JSON.stringify(PRODUCTION_HOSTNAMES)}.indexOf(location.hostname) !== -1) {
      gtag('js', new Date());
      gtag('config', '${GA_TRACKING_ID}');
    }
  `;
}
