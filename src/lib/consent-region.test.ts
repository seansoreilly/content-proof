import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/consent-region/route";
import { COUNTRY_HEADER, consentRequiredFor } from "@/lib/consent-region";

describe("consentRequiredFor", () => {
  it("requires opt-in in the EU, EEA, UK and Switzerland", () => {
    for (const code of ["DE", "FR", "IE", "NO", "IS", "LI", "GB", "CH", "gr"]) {
      expect(consentRequiredFor(code), code).toBe(true);
    }
  });

  it("does not require it elsewhere", () => {
    for (const code of ["AU", "NZ", "US", "SG", "JP"]) {
      expect(consentRequiredFor(code), code).toBe(false);
    }
  });

  it("treats a missing or malformed country as requiring consent", () => {
    for (const value of [null, undefined, "", "XXX", "1A", " "]) {
      expect(consentRequiredFor(value)).toBe(true);
    }
  });
});

describe("GET /api/consent-region", () => {
  const call = (country?: string): Response =>
    GET(new Request("http://localhost/api/consent-region", { headers: country ? { [COUNTRY_HEADER]: country } : {} }));

  it("answers from the Vercel country header without echoing the country", async () => {
    const au = call("AU");
    expect(au.status).toBe(200);
    expect(au.headers.get("cache-control")).toBe("private, no-store");
    expect(await au.json()).toEqual({ consentRequired: false });
    expect(await call("DE").json()).toEqual({ consentRequired: true });
    expect(await call().json()).toEqual({ consentRequired: true });
  });
});
