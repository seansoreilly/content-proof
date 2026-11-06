import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_ORIGIN, resolveSiteOrigin } from "@/lib/site-origin";

function headersOf(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("resolveSiteOrigin", () => {
  it("prefers the configured base URL, without a trailing slash", () => {
    const headers = headersOf({ host: "other.example", "x-forwarded-proto": "http" });
    expect(resolveSiteOrigin({ NEXT_PUBLIC_VERIFY_BASE_URL: "https://proof.example/" }, headers)).toBe(
      "https://proof.example"
    );
  });

  it("ignores an empty configured value", () => {
    expect(resolveSiteOrigin({ NEXT_PUBLIC_VERIFY_BASE_URL: "  " }, headersOf({ host: "a.example" }))).toBe(
      "https://a.example"
    );
  });

  it("uses the request host and x-forwarded-proto", () => {
    expect(resolveSiteOrigin({}, headersOf({ host: "a.example", "x-forwarded-proto": "http" }))).toBe(
      "http://a.example"
    );
    expect(resolveSiteOrigin({}, headersOf({ host: "a.example:8443", "x-forwarded-proto": "https, http" }))).toBe(
      "https://a.example:8443"
    );
  });

  it("defaults to https, or http for a localhost host", () => {
    expect(resolveSiteOrigin({}, headersOf({ host: "a.example" }))).toBe("https://a.example");
    expect(resolveSiteOrigin({}, headersOf({ host: "localhost:3101" }))).toBe("http://localhost:3101");
    expect(resolveSiteOrigin({}, headersOf({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
    expect(resolveSiteOrigin({}, headersOf({ host: "[::1]:3000" }))).toBe("http://[::1]:3000");
  });

  it("ignores an unrecognised x-forwarded-proto", () => {
    expect(resolveSiteOrigin({}, headersOf({ host: "a.example", "x-forwarded-proto": "javascript" }))).toBe(
      "https://a.example"
    );
  });

  it("falls back to the production origin without a usable host", () => {
    expect(resolveSiteOrigin({}, null)).toBe(DEFAULT_SITE_ORIGIN);
    expect(resolveSiteOrigin({}, headersOf({}))).toBe(DEFAULT_SITE_ORIGIN);
    expect(resolveSiteOrigin({}, headersOf({ host: "a.example/path?x" }))).toBe(DEFAULT_SITE_ORIGIN);
    expect(resolveSiteOrigin({}, headersOf({ host: "user@a.example" }))).toBe(DEFAULT_SITE_ORIGIN);
  });
});
