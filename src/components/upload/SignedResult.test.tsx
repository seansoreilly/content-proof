import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadEntry } from "@/components/upload/upload-reducer";

// The seal draws to a canvas, which jsdom lacks; only its presence matters here.
vi.mock("@/components/QrCodeGenerator", () => ({
  QrCodeGenerator: () => <div data-testid="seal" />,
}));

const { SignedResult } = await import("@/components/upload/SignedResult");

const record = { v: 2, k: "AAAAAAAAAAAAAAAA", h: "A".repeat(43), e: "a@example.com", t: 1, s: "B".repeat(86) } as const;

function entry(status: UploadEntry["status"]): UploadEntry {
  return { id: 0, name: "a.txt", size: 10, isImage: false, hash: "ab".repeat(32), status };
}

describe("SignedResult", () => {
  afterEach(cleanup);

  it("notes under the seal when the record was not stored or logged", () => {
    render(<SignedResult entry={entry({ kind: "done", record, logged: false })} previewUrl={null} />);
    expect(screen.getByTestId("seal")).toBeTruthy();
    expect(screen.getByTestId("not-logged").textContent).toBe(
      "Signed, but the service could not store this record or add it to the transparency log. The seal still verifies; keep it safe.",
    );
  });

  it("says nothing extra for a logged record or one not signed yet", () => {
    render(<SignedResult entry={entry({ kind: "done", record, logged: true })} previewUrl={null} />);
    expect(screen.getByTestId("seal")).toBeTruthy();
    expect(screen.queryByTestId("not-logged")).toBeNull();
    cleanup();

    render(<SignedResult entry={entry({ kind: "signing" })} previewUrl={null} />);
    expect(screen.queryByTestId("seal")).toBeNull();
    expect(screen.queryByTestId("not-logged")).toBeNull();
  });
});
