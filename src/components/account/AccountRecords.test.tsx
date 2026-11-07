import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountRecords } from "@/components/account/AccountRecords";
import type { SignatureRecord } from "@/lib/record";

const base: SignatureRecord = {
  v: 3,
  k: "AAAAAAAAAAAAAAAA",
  h: "q83vEjRWeJC6zd8SNFZ4kLrN3xI0VniQus3fEjRWeJA",
  e: "a@example.com",
  t: Date.UTC(2026, 0, 2, 3, 4, 5),
  s: "S".repeat(86),
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AccountRecords", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists records with hash prefix, version and a record link, and loads more", async () => {
    const older: SignatureRecord = { ...base, v: 2, t: base.t - 1000, s: "T".repeat(86) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond({ records: [{ record: base, logIndex: 4 }], nextCursor: "c1" }))
      .mockResolvedValueOnce(respond({ records: [{ record: older }], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountRecords />);
    expect(await screen.findByText("Signed by your browser key")).toBeTruthy();
    expect(screen.getByText(/abcdef123456…/)).toBeTruthy();
    expect(screen.getByText(/log #4/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View record" }).getAttribute("href")).toBe(`/sig/${base.s}`);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Service attestation only")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "View record" })).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=c1");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows an empty state and an error state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respond({ records: [], nextCursor: null })));
    render(<AccountRecords />);
    expect(await screen.findByText(/Nothing signed yet/)).toBeTruthy();
    cleanup();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respond({ error: "x" }, 503)));
    render(<AccountRecords />);
    expect((await screen.findByRole("alert")).textContent).toContain("503");
  });
});
