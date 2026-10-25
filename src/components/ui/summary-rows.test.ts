import { describe, expect, it } from "vitest";
import { buildSummaryRows } from "./summary-rows";
import type { SignatureRecord } from "@/lib/record";

const base: SignatureRecord = {
  v: 2,
  k: "AAAAAAAAAAAAAAAA",
  h: "q83vEjRWeJC6zd8SNFZ4kLrN3xI0VniQus3fEjRWeJA",
  e: "a@example.com",
  t: Date.UTC(2026, 0, 2, 3, 4, 5),
  s: "s",
};

describe("buildSummaryRows", () => {
  it("omits hash and log rows by default", () => {
    const labels = buildSummaryRows(base).map((r) => r.label);
    expect(labels).toEqual([
      "Attested for",
      "At",
      "Service key",
      "Account holder's key",
    ]);
  });

  it("states service-only attestation when no account key", () => {
    const row = buildSummaryRows(base).find((r) => r.label === "Account holder's key");
    expect(row?.value).toBe("none, service attestation only");
  });

  it("shows hash as hex and iso time when asked", () => {
    const rows = buildSummaryRows(base, { showHash: true, timeFormat: "iso" });
    expect(rows.find((r) => r.label === "At")?.value).toBe("2026-01-02T03:04:05.000Z");
    expect(rows.find((r) => r.label === "File SHA-256")?.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("renders log entry states", () => {
    expect(
      buildSummaryRows(base, { logIndex: null }).find((r) => r.label === "Log entry")?.value,
    ).toBe("not recorded");
    expect(
      buildSummaryRows(base, { logIndex: 7 }).find((r) => r.label === "Log entry")?.value,
    ).toBe("#7");
  });

  it("uses the account holder's key for v3 records", () => {
    const rows = buildSummaryRows({ ...base, v: 3, u: "USERKEY", us: "sig" });
    expect(rows.find((r) => r.label === "Account holder's key")?.value).toBe("USERKEY");
  });
});
