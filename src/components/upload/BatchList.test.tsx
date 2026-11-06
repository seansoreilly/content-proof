import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchList } from "@/components/upload/BatchList";
import { HashProgress } from "@/components/upload/HashProgress";
import type { UploadEntry } from "@/components/upload/upload-reducer";

const entries: UploadEntry[] = [
  {
    id: 0,
    name: "a.txt",
    size: 2048,
    isImage: false,
    hash: "ab".repeat(32),
    status: {
      kind: "done",
      record: { v: 2, k: "AAAAAAAAAAAAAAAA", h: "A".repeat(43), e: "a@example.com", t: 1, s: "B".repeat(86) },
    },
  },
  { id: 1, name: "empty.txt", size: 0, isImage: false, hash: null, status: { kind: "failed", message: "The selected file is empty." } },
  { id: 2, name: "big.bin", size: 4096, isImage: false, hash: null, status: { kind: "hashing", done: 1024, total: 4096 } },
  { id: 3, name: "later.txt", size: 10, isImage: false, hash: null, status: { kind: "skipped", reason: "Not signed." } },
];

describe("BatchList", () => {
  afterEach(cleanup);

  it("shows each file's name, size, fingerprint and status", () => {
    render(<BatchList entries={entries} selectedId={0} onSelect={() => {}} />);
    expect(screen.getByText("Files · 1 of 4 signed")).toBeTruthy();
    const rows = screen.getAllByTestId("batch-entry");
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual(["done", "failed", "hashing", "skipped"]);
    expect(rows[0].getAttribute("aria-pressed")).toBe("true");
    expect(rows[0].textContent).toContain("2.00 KB");
    expect(rows[0].textContent).toContain("ab".repeat(32));
    expect(rows[0].textContent).toContain("Signed");
    expect(rows[1].textContent).toContain("Failed: The selected file is empty.");
    expect(rows[2].textContent).toContain("Hashing 25%");
    expect(rows[3].textContent).toContain("Not signed.");
  });

  it("selects an entry when it is clicked", () => {
    const onSelect = vi.fn();
    render(<BatchList entries={entries} selectedId={0} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByTestId("batch-entry")[2]);
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});

describe("HashProgress", () => {
  afterEach(cleanup);

  it("shows the percentage read and cancels", () => {
    const onCancel = vi.fn();
    render(<HashProgress done={50} total={200} onCancel={onCancel} />);
    expect(screen.getByRole("status").textContent).toContain("Reading the file: 25%");
    expect((screen.getByLabelText("Reading the file") as HTMLProgressElement).value).toBe(25);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("offers Cancel without a bar while signing", () => {
    render(<HashProgress done={null} total={0} onCancel={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });
});
