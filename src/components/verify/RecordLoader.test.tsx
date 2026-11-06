import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecordLoader } from "@/components/verify/RecordLoader";
import type { LoadedInput } from "@/lib/verify-input";

const noop = (): void => {};
const handlers = { onManualInputChange: noop, onLoadManual: noop, onQrImage: noop, onClear: noop };

describe("RecordLoader", () => {
  afterEach(cleanup);

  it("offers paste and QR upload when nothing is loaded", () => {
    render(<RecordLoader loaded={null} manualInput="" decodingQr={false} {...handlers} />);
    expect(screen.getByLabelText("Paste a verification link or record")).toBeTruthy();
    expect(screen.getByLabelText("Or upload a picture of the QR code")).toBeTruthy();
  });

  it("presents a loaded record's contents as unverified claims", () => {
    const loaded: LoadedInput = {
      kind: "record",
      record: { v: 2, k: "KEYID", h: "h", e: "a\u200b@example.com", t: Date.UTC(2026, 0, 2), s: "s" },
    };
    render(<RecordLoader loaded={loaded} manualInput="" decodingQr={false} {...handlers} />);
    expect(screen.getByText("Record loaded, not yet verified")).toBeTruthy();
    expect(screen.getByText("Claims to be for")).toBeTruthy();
    expect(screen.queryByText("Attested for")).toBeNull();
    expect(screen.getByText("a@example.com", { exact: false }).textContent).toBe(
      "a@example.com (hidden characters removed)",
    );
    expect(screen.getByText("KEYID")).toBeTruthy();
  });
});
