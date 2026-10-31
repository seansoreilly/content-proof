import { afterEach, describe, expect, it, vi } from "vitest";
import { gaInitScript, isProductionHost, track } from "./analytics";

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

describe("gaInitScript", () => {
  it("only configures GA on production hostnames", () => {
    const script = gaInitScript();
    expect(script).toContain("www.contentproof.app");
    expect(script).toMatch(/if \([\s\S]*indexOf\(location\.hostname\) !== -1\)/);
    expect(script.indexOf("gtag('config'")).toBeGreaterThan(script.indexOf("indexOf(location.hostname)"));
  });
});
