import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FAILURE_MESSAGES, VerificationOutcome } from "@/components/verify/VerificationOutcome";

const at = Date.UTC(2026, 0, 2, 3, 4, 5);

describe("VerificationOutcome", () => {
  afterEach(cleanup);

  it("shows a verified service-only record with its log status", () => {
    render(
      <VerificationOutcome
        result={{ ok: true, keyId: "KEYID123", userSigned: false }}
        email="a@example.com"
        attestedMs={at}
        logStatus={{ kind: "included", index: 4, size: 9 }}
      />,
    );
    expect(screen.getByText("Attestation verified")).toBeTruthy();
    expect(screen.getByText("a@example.com")).toBeTruthy();
    expect(screen.getByTestId("user-signature").textContent).toContain("attestation by the service only");
    expect(screen.getByText("KEYID123")).toBeTruthy();
    expect(screen.getByTestId("log-status").textContent).toBe(
      "Included in the transparency log as entry 5 of 9; inclusion proof and signed tree head verified.",
    );
    expect(document.querySelector(`time[datetime="${new Date(at).toISOString()}"]`)).not.toBeNull();
  });

  it("names the account holder's key for a user-signed record", () => {
    render(
      <VerificationOutcome
        result={{ ok: true, keyId: "KEYID123", userSigned: true, userKey: "USERKEY" }}
        email="a@example.com"
        attestedMs={at}
        logStatus={{ kind: "checking" }}
      />,
    );
    expect(screen.getByTestId("user-signature").textContent).toContain("Also signed by the account holder");
    expect(screen.getByText("USERKEY")).toBeTruthy();
    expect(screen.getByTestId("log-status").textContent).toBe("Checking the transparency log…");
  });

  it("strips hidden characters from the address and says so", () => {
    render(
      <VerificationOutcome
        result={{ ok: true, keyId: "k" }}
        email={"\u202emoc.live@x"}
        attestedMs={at}
        logStatus={null}
      />,
    );
    expect(screen.getByText("moc.live@x", { exact: false }).textContent).toContain("(hidden characters removed)");
    expect(screen.queryByTestId("log-status")).toBeNull();
  });

  it("explains a failure", () => {
    render(
      <VerificationOutcome result={{ ok: false, reason: "hash-mismatch" }} email="" attestedMs={at} logStatus={null} />,
    );
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.getByText(FAILURE_MESSAGES["hash-mismatch"])).toBeTruthy();
    expect(screen.queryByTestId("user-signature")).toBeNull();
  });
});
