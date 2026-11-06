import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_STORAGE_KEY,
  DEFAULT_GA_TRACKING_ID,
  FORCE_BANNER_STORAGE_KEY,
  isProductionHost,
  loadGoogleAnalytics,
  readConsent,
  readForceBanner,
  resolveGaTrackingId,
  shouldShowConsentBanner,
  track,
  writeConsent,
  type ConsentStorage,
} from "./analytics";

function stubWindow(hostname: string, gtag?: (...args: unknown[]) => void): void {
  vi.stubGlobal("window", { location: { hostname }, gtag });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isProductionHost", () => {
  it("accepts the production hostnames only", () => {
    expect(isProductionHost("www.contentproof.app")).toBe(true);
    expect(isProductionHost("contentproof.app")).toBe(true);
    expect(isProductionHost("localhost")).toBe(false);
    expect(isProductionHost("contentproof-git-feat-x.vercel.app")).toBe(false);
    expect(isProductionHost("evil-contentproof.app")).toBe(false);
  });
});

describe("track", () => {
  it("sends to gtag on a production host", () => {
    const gtag = vi.fn();
    stubWindow("www.contentproof.app", gtag);
    track("verify_signature", { result: "success", record_kind: "record" });
    expect(gtag).toHaveBeenCalledWith("event", "verify_signature", {
      result: "success",
      record_kind: "record",
    });
  });

  it("logs instead of sending on localhost and previews", () => {
    const gtag = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const host of ["localhost", "preview-abc.vercel.app"]) {
      stubWindow(host, gtag);
      track("sign_file_failed", { error_type: "unknown" });
    }
    expect(gtag).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("never throws when gtag throws or is missing", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubWindow("www.contentproof.app", () => {
      throw new Error("boom");
    });
    expect(() => track("download_seal", {})).not.toThrow();
    stubWindow("www.contentproof.app");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() => track("download_seal", {})).not.toThrow();
  });
});

describe("track without consent", () => {
  it("is a silent no-op on a production host when gtag is not loaded", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    stubWindow("contentproof.app");
    expect(() => track("download_seal", {})).not.toThrow();
    expect(log).not.toHaveBeenCalled();
  });
});

function memoryStorage(initial: Record<string, string> = {}): ConsentStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: ConsentStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("consent storage helpers", () => {
  it("round-trips a choice under the versioned key", () => {
    const storage = memoryStorage();
    expect(readConsent(storage)).toBeNull();
    expect(writeConsent(storage, "granted")).toBe(true);
    expect(storage.data[CONSENT_STORAGE_KEY]).toBe("granted");
    expect(readConsent(storage)).toBe("granted");
    expect(writeConsent(storage, "denied")).toBe(true);
    expect(readConsent(storage)).toBe("denied");
  });

  it("treats unexpected stored values as no choice", () => {
    expect(readConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: "yes" }))).toBeNull();
    expect(readConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: "" }))).toBeNull();
  });

  it("treats missing or throwing storage as no consent and never throws", () => {
    expect(readConsent(null)).toBeNull();
    expect(writeConsent(null, "granted")).toBe(false);
    expect(readConsent(throwingStorage)).toBeNull();
    expect(writeConsent(throwingStorage, "granted")).toBe(false);
    expect(readForceBanner(throwingStorage)).toBe(false);
    expect(readForceBanner(null)).toBe(false);
  });

  it("reads the test-only force flag only when it is exactly 1", () => {
    expect(readForceBanner(memoryStorage({ [FORCE_BANNER_STORAGE_KEY]: "1" }))).toBe(true);
    expect(readForceBanner(memoryStorage({ [FORCE_BANNER_STORAGE_KEY]: "true" }))).toBe(false);
    expect(readForceBanner(memoryStorage())).toBe(false);
  });
});

describe("shouldShowConsentBanner", () => {
  const base = {
    trackingId: DEFAULT_GA_TRACKING_ID,
    hostname: "www.contentproof.app",
    consent: null,
    forceBanner: false,
  } as const;

  it("shows only on production hosts with no stored choice", () => {
    expect(shouldShowConsentBanner(base)).toBe(true);
    expect(shouldShowConsentBanner({ ...base, hostname: "localhost" })).toBe(false);
    expect(shouldShowConsentBanner({ ...base, consent: "denied" })).toBe(false);
    expect(shouldShowConsentBanner({ ...base, consent: "granted" })).toBe(false);
  });

  it("honours the force flag off production but never when GA is disabled", () => {
    expect(shouldShowConsentBanner({ ...base, hostname: "localhost", forceBanner: true })).toBe(true);
    expect(shouldShowConsentBanner({ ...base, trackingId: null })).toBe(false);
    expect(shouldShowConsentBanner({ ...base, trackingId: null, forceBanner: true })).toBe(false);
  });
});

describe("resolveGaTrackingId", () => {
  it("keeps the default ID when unset", () => {
    expect(resolveGaTrackingId(undefined)).toBe(DEFAULT_GA_TRACKING_ID);
  });

  it("disables GA for an empty value or off", () => {
    expect(resolveGaTrackingId("")).toBeNull();
    expect(resolveGaTrackingId("  ")).toBeNull();
    expect(resolveGaTrackingId("off")).toBeNull();
    expect(resolveGaTrackingId("OFF")).toBeNull();
  });

  it("uses a configured ID", () => {
    expect(resolveGaTrackingId(" G-TEST123 ")).toBe("G-TEST123");
  });
});

describe("loadGoogleAnalytics", () => {
  function stubDom(hostname: string): { appended: { id: string; src: string }[] } {
    const appended: { id: string; src: string }[] = [];
    vi.stubGlobal("window", { location: { hostname } });
    vi.stubGlobal("document", {
      getElementById: (id: string) => appended.find((el) => el.id === id) ?? null,
      createElement: () => ({ id: "", src: "", async: false }),
      head: { appendChild: (el: { id: string; src: string }) => appended.push(el) },
    });
    return { appended };
  }

  it("injects gtag once on a production host and configures the ID", () => {
    const { appended } = stubDom("www.contentproof.app");
    loadGoogleAnalytics("G-TEST123");
    loadGoogleAnalytics("G-TEST123");
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe("https://www.googletagmanager.com/gtag/js?id=G-TEST123");
    const dataLayer = (window as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [];
    expect(dataLayer.map((args) => Array.from(args)[0])).toEqual(["js", "config"]);
    expect(Array.from(dataLayer[1])).toEqual(["config", "G-TEST123"]);
  });

  it("does nothing off production or when GA is disabled", () => {
    const local = stubDom("localhost");
    loadGoogleAnalytics("G-TEST123");
    expect(local.appended).toHaveLength(0);
    expect(window.gtag).toBeUndefined();

    const prod = stubDom("contentproof.app");
    loadGoogleAnalytics(null);
    expect(prod.appended).toHaveLength(0);
  });
});
