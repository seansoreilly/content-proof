"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { Button, Panel } from "@/components/ui";
import {
  GA_TRACKING_ID,
  browserStorage,
  loadGoogleAnalytics,
  readConsent,
  readForceBanner,
  shouldShowConsentBanner,
  writeConsent,
  type AnalyticsConsent,
} from "@/lib/analytics";

/**
 * Asks for analytics consent on the production hostnames and loads Google
 * Analytics only once the visitor accepts. A stored "granted" loads GA on
 * later visits without asking again; a stored "denied" keeps the banner hidden
 * and GA unloaded. Everything runs after mount, so the server render is empty
 * and hydration never mismatches.
 */
export function ConsentBanner(): ReactElement | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const storage = browserStorage();
    const consent = readConsent(storage);
    if (consent === "granted") loadGoogleAnalytics();
    setVisible(
      shouldShowConsentBanner({
        trackingId: GA_TRACKING_ID,
        hostname: window.location.hostname,
        consent,
        forceBanner: readForceBanner(storage),
      }),
    );
  }, []);

  const choose = (consent: AnalyticsConsent): void => {
    // If storage is unavailable the choice still applies to this page view.
    writeConsent(browserStorage(), consent);
    if (consent === "granted") loadGoogleAnalytics();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <Panel className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[60ch] text-sm text-ink">
          May we use Google Analytics to count visits and which features get
          used? Your files never leave your browser either way.{" "}
          <Link href="/privacy" className="underline hover:text-accent">
            Privacy
          </Link>
        </p>
        <div className="flex shrink-0 gap-3">
          <Button variant="secondary" onClick={() => choose("denied")}>
            Decline
          </Button>
          <Button onClick={() => choose("granted")}>Accept</Button>
        </div>
      </Panel>
    </div>
  );
}
