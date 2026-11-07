"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { Button, Panel } from "@/components/ui";
import {
  GA_TRACKING_ID,
  browserStorage,
  loadGoogleAnalytics,
  readConsent,
  decideAnalytics,
  fetchConsentRequired,
  needsRegionCheck,
  readForceBanner,
  writeConsent,
  type AnalyticsContext,
  type AnalyticsConsent,
} from "@/lib/analytics";

/**
 * Loads Google Analytics on the production hostnames, asking first where the
 * visitor's region requires opt-in (EU, EEA, UK, Switzerland; see
 * `consent-region.ts`). A stored choice always wins: "granted" loads GA
 * without asking again, "denied" keeps it unloaded. Everyone else gets GA as
 * disclosed in the privacy policy. Everything runs after mount, so the server
 * render is empty, pages stay static and hydration never mismatches.
 */
export function ConsentBanner(): ReactElement | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const storage = browserStorage();
    const context: AnalyticsContext = {
      trackingId: GA_TRACKING_ID,
      hostname: window.location.hostname,
      consent: readConsent(storage),
      forceBanner: readForceBanner(storage),
    };
    const apply = (consentRequired: boolean): void => {
      if (cancelled) return;
      const decision = decideAnalytics(context, consentRequired);
      if (decision === "load") loadGoogleAnalytics();
      setVisible(decision === "banner");
    };
    if (needsRegionCheck(context)) void fetchConsentRequired().then(apply);
    else apply(true);
    return () => {
      cancelled = true;
    };
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
