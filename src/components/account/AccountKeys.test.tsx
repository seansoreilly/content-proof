import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const BROWSER_KEY = "B".repeat(43);
const OTHER_KEY = "O".repeat(43);
const NEW_KEY = "N".repeat(43);

// jsdom has neither Ed25519 WebCrypto nor IndexedDB; stand in for this browser's key.
vi.mock("@/lib/user-keys", () => ({
  getOrCreateUserKey: vi.fn(async () => ({ publicKey: BROWSER_KEY, sign: async () => "" })),
  // Replaces the key only when the revoked one is this browser's, as the real one does.
  replaceRevokedUserKey: vi.fn(async (revoked: string) =>
    revoked === BROWSER_KEY
      ? { key: { publicKey: NEW_KEY, sign: async () => "" }, rotated: true }
      : { key: { publicKey: BROWSER_KEY, sign: async () => "" }, rotated: false }
  ),
}));

const { replaceRevokedUserKey } = await import("@/lib/user-keys");

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
    expect(within(row).getByText(/this browser will get a new key/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/account/keys/revoke")).toBe(false);

    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(within(row).queryByRole("button", { name: "Confirm revoke" })).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(row).getByRole("button", { name: "Confirm revoke" }));
    expect(await within(row).findByText("Revoked")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Revoke" })).toBeNull();
    // This browser's key was replaced: the marker leaves the revoked row, and
    // the new key is not listed until it signs something.
    expect((await screen.findByTestId("new-key-note")).textContent).toContain(
      "This browser now has a new signing key; it is registered the next time you sign.",
    );
    expect(screen.getByTestId("new-browser-key").textContent).toBe(NEW_KEY);
    expect(screen.queryAllByTestId("this-browser")).toHaveLength(0);
    expect(replaceRevokedUserKey).toHaveBeenCalledWith(BROWSER_KEY);
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
    expect(replaceRevokedUserKey).not.toHaveBeenCalled();
  });

  it("keeps this browser's key when another key is revoked", async () => {
    let revokedAt: number | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/account/keys/revoke") {
          revokedAt = 3;
          return respond({ key: { publicKey: OTHER_KEY, firstSeen: 1, lastSeen: 2, revokedAt } });
        }
        return respond({
          keys: [
            { publicKey: BROWSER_KEY, firstSeen: 1, lastSeen: 2 },
            { publicKey: OTHER_KEY, firstSeen: 1, lastSeen: 2, ...(revokedAt ? { revokedAt } : {}) },
          ],
        });
      })
    );
    render(<AccountKeys />);
    await screen.findByTestId("this-browser");
    const otherRow = screen.getByText(OTHER_KEY).closest("li")!;
    fireEvent.click(within(otherRow).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(otherRow).getByRole("button", { name: "Confirm revoke" }));
    expect(await within(otherRow).findByText("Revoked")).toBeTruthy();
    await vi.waitFor(() => expect(replaceRevokedUserKey).toHaveBeenCalledWith(OTHER_KEY));
    expect(screen.queryByTestId("new-key-note")).toBeNull();
    expect(screen.getByTestId("this-browser").closest("li")!.getAttribute("data-public-key")).toBe(BROWSER_KEY);
  });
});
