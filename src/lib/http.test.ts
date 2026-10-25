import { describe, expect, it } from "vitest";
import { corsHeaders, corsPreflight, parseNonNegativeInt } from "@/lib/http";

describe("parseNonNegativeInt", () => {
  it("accepts plain decimal integers", () => {
    expect(parseNonNegativeInt("0")).toBe(0);
    expect(parseNonNegativeInt("42")).toBe(42);
    expect(parseNonNegativeInt("007")).toBe(7);
  });

  it("rejects everything that is not plain digits", () => {
    for (const bad of ["", " ", "0x10", "1e9", "-1", "+1", "abc", "1.5", " 1", "1 ", "1234567890123456"]) {
      expect(parseNonNegativeInt(bad, 5)).toBeNull();
    }
  });

  it("uses the fallback only for a missing value", () => {
    expect(parseNonNegativeInt(null, 100)).toBe(100);
    expect(parseNonNegativeInt(null)).toBeNull();
  });
});

describe("cors helpers", () => {
  it("builds permissive headers and merges extras", () => {
    const h = corsHeaders({ "Cache-Control": "no-store" });
    expect(h["Access-Control-Allow-Origin"]).toBe("*");
    expect(h["Access-Control-Allow-Headers"]).toBe("Content-Type");
    expect(h["Access-Control-Max-Age"]).toBe("86400");
    expect(h["Cache-Control"]).toBe("no-store");
  });

  it("answers preflight with 204 and the allowed methods", () => {
    const res = corsPreflight(["POST"]);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
