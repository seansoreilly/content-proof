/* eslint-disable @typescript-eslint/ban-ts-comment */
// Google Analytics helper utilities for client-side usage
// Docs: https://developers.google.com/analytics/devguides/collection/ga4
// Only loads in the browser – safe to import in client components

export const GA_TRACKING_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-SXYXFW00DL";

// Ensure TypeScript knows about the gtag function on window
// @ts-ignore – extend Window interface at runtime
declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
  }
}

/**
 * Send page_view event when a route changes
 * @param url current path
 */
export function pageview(url: string) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;
  window.gtag("config", GA_TRACKING_ID, {
    page_path: url,
  });
}

interface GAEvent {
  action: string;
  event_category?: string;
  event_label?: string;
  value?: number;
}

/**
 * Generic event dispatcher for GA4
 */
export function gaEvent({
  action,
  event_category,
  event_label,
  value,
}: GAEvent) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;
  window.gtag("event", action, {
    event_category,
    event_label,
    value,
  });
}

// Convenience wrappers for our custom events
export const trackSignFile = () =>
  gaEvent({ action: "sign_file", event_category: "engagement" });

export const trackVerifySignature = (result: "success" | "failure") =>
  gaEvent({
    action: "verify_signature",
    event_category: "engagement",
    event_label: result,
  });

export const trackUserRegistration = () =>
  gaEvent({ action: "user_registration", event_category: "engagement" }); 