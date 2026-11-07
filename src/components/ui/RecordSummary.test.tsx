import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecordSummary } from "@/components/ui/RecordSummary";
import type { SignatureRecord } from "@/lib/record";

const record: SignatureRecord = {
  v: 2,
  k: "AAAAAAAAAAAAAAAA",
  h: "q83vEjRWeJC6zd8SNFZ4kLrN3xI0VniQus3fEjRWeJA",
  e: "a@example.com",
  t: Date.UTC(2026, 0, 2, 3, 4, 5),
  s: "s",
};

describe("RecordSummary", () => {
  afterEach(cleanup);

  it("renders the summary labels and values", () => {
    render(<RecordSummary record={record} />);
    for (const label of ["Attested for", "At", "Service key id", "Account holder's key"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("a@example.com")).toBeTruthy();
    expect(screen.getByText("AAAAAAAAAAAAAAAA")).toBeTruthy();
    expect(screen.getByText("none, service attestation only")).toBeTruthy();
  });

  it("adds the hash and log rows when asked", () => {
    render(<RecordSummary record={record} showHash logIndex={7} timeFormat="iso" />);
    expect(screen.getAllByRole("term")).toHaveLength(6);
    expect(screen.getByText("File SHA-256")).toBeTruthy();
    expect(screen.getByText("Log entry")).toBeTruthy();
    expect(screen.getByText("#7")).toBeTruthy();
    const iso = new Date(record.t).toISOString();
    expect(document.querySelectorAll(`time[datetime="${iso}"]`).length).toBeGreaterThan(0);
  });
});
