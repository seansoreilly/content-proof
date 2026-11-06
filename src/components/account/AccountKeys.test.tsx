import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const BROWSER_KEY = "B".repeat(43);
const OTHER_KEY = "O".repeat(43);

// jsdom has neither Ed25519 WebCrypto nor IndexedDB; stand in for this browser's key.
vi.mock("@/lib/user-keys", () => ({
  getOrCreateUserKey: vi.fn(async () => ({ publicKey: BROWSER_KEY, sign: async () => "" })),
}));

const { AccountKeys } = await import("@/components/account/AccountKeys");

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AccountKeys", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("marks this browser's key and revokes a key only after confirming", async () => {
    let revokedAt: number | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/account/keys/revoke") {
        expect(JSON.parse(String(init?.body))).toEqual({ publicKey: BROWSER_KEY });
        revokedAt = 3000;
        return respond({ key: { publicKey: BROWSER_KEY, firstSeen: 1000, lastSeen: 2000, revokedAt } });
      }
      return respond({
        keys: [
          { publicKey: BROWSER_KEY, firstSeen: 1000, lastSeen: 2000, ...(revokedAt ? { revokedAt } : {}) },
          { publicKey: OTHER_KEY, firstSeen: 500, lastSeen: 600 },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountKeys />);
    const marker = await screen.findByTestId("this-browser");
    const row = marker.closest("li")!;
    expect(row.getAttribute("data-public-key")).toBe(BROWSER_KEY);
    expect(screen.getAllByTestId("this-browser")).toHaveLength(1);

    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    expect(within(row).getByText(/this browser will no longer be able to sign/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/account/keys/revoke")).toBe(false);

    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(within(row).queryByRole("button", { name: "Confirm revoke" })).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(row).getByRole("button", { name: "Confirm revoke" }));
    expect(await within(row).findByText("Revoked")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Revoke" })).toBeNull();
    // the other key is untouched
    const otherRow = screen.getByText(OTHER_KEY).closest("li")!;
    expect(within(otherRow).getByRole("button", { name: "Revoke" })).toBeTruthy();
  });

  it("shows the server's message when revocation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/account/keys/revoke"
          ? respond({ error: "No such key on this account" }, 404)
          : respond({ keys: [{ publicKey: OTHER_KEY, firstSeen: 1, lastSeen: 2 }] })
      )
    );
    render(<AccountKeys />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No such key on this account");
  });
});
