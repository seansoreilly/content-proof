import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { USER_KEY_REVOKED_MESSAGE } from "@/lib/user-key-status";

const OLD_KEY = "O".repeat(43);
const NEW_KEY = "N".repeat(43);
const OTHER_TAB_KEY = "T".repeat(43);

function key(publicKey: string): { publicKey: string; sign: () => Promise<string> } {
  return { publicKey, sign: async () => `sig-${publicKey}` };
}

// jsdom has neither Ed25519 WebCrypto nor IndexedDB; stand in for the key store.
// replaceRevokedUserKey keeps its real logic, over the mocked store.
vi.mock("@/lib/user-keys", () => {
  const getOrCreateUserKey = vi.fn();
  const rotateUserKey = vi.fn();
  return {
    getOrCreateUserKey,
    rotateUserKey,
    replaceRevokedUserKey: async (revoked: string) => {
      const stored = await getOrCreateUserKey();
      if (stored.publicKey !== revoked) return { key: stored, rotated: false };
      return { key: await rotateUserKey(), rotated: true };
    },
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/hash", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/hash")>()),
  sha256Hash: vi.fn(async () => "A".repeat(43)),
}));

const userKeys = await import("@/lib/user-keys");
const getOrCreateUserKey = vi.mocked(userKeys.getOrCreateUserKey);
const rotateUserKey = vi.mocked(userKeys.rotateUserKey);
const { useBatchSigner } = await import("@/components/upload/useBatchSigner");

const record = {
  v: 2,
  k: "AAAAAAAAAAAAAAAA",
  h: "A".repeat(43),
  e: "a@example.com",
  t: 1_700_000_000_000,
  s: "B".repeat(86),
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fileList(...names: string[]): FileList {
  return names.map((name) => new File(["x"], name, { type: "text/plain" })) as unknown as FileList;
}

/** Answers with the revoked 403 for any request signed with one of `revoked`. */
function signServer(revoked: string[]): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { userPublicKey?: string };
    if (body.userPublicKey && revoked.includes(body.userPublicKey)) {
      return respond({ error: USER_KEY_REVOKED_MESSAGE }, 403);
    }
    return respond({ record, logIndex: 0, logged: true });
  });
}

async function mountSigner(): Promise<ReturnType<typeof renderHook<ReturnType<typeof useBatchSigner>, unknown>>> {
  const hook = renderHook(() => useBatchSigner("a@example.com"));
  await waitFor(() => expect(hook.result.current.userKey).not.toBeNull());
  return hook;
}

describe("useBatchSigner after this browser's key is revoked", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("replaces the key once, retries the file, and signs later files with the new key", async () => {
    getOrCreateUserKey.mockResolvedValue(key(OLD_KEY));
    rotateUserKey.mockResolvedValue(key(NEW_KEY));
    const fetchMock = signServer([OLD_KEY]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = await mountSigner();
    expect(result.current.userKey).toMatchObject({ publicKey: OLD_KEY });

    await act(() => result.current.signFiles(fileList("a.txt", "b.txt"), "picker"));

    expect(result.current.state.entries.map((entry) => entry.status.kind)).toEqual(["done", "done"]);
    expect(result.current.state.entries[0].status).toMatchObject({ kind: "done", logged: true });
    expect(rotateUserKey).toHaveBeenCalledTimes(1);
    const sentKeys = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).userPublicKey);
    expect(sentKeys).toEqual([OLD_KEY, NEW_KEY, NEW_KEY]);
    // The "Your signing key" display follows the new key.
    expect(result.current.userKey).toMatchObject({ publicKey: NEW_KEY });
  });

  it("uses a key another tab already stored instead of making a third", async () => {
    getOrCreateUserKey.mockResolvedValueOnce(key(OLD_KEY)).mockResolvedValue(key(OTHER_TAB_KEY));
    const fetchMock = signServer([OLD_KEY]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = await mountSigner();
    await act(() => result.current.signFiles(fileList("a.txt"), "picker"));

    expect(result.current.state.entries[0].status.kind).toBe("done");
    expect(rotateUserKey).not.toHaveBeenCalled();
    expect(result.current.userKey).toMatchObject({ publicKey: OTHER_TAB_KEY });
  });

  it("shows the error when the retry is refused too, without retrying again", async () => {
    getOrCreateUserKey.mockResolvedValue(key(OLD_KEY));
    rotateUserKey.mockResolvedValue(key(NEW_KEY));
    const fetchMock = signServer([OLD_KEY, NEW_KEY]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = await mountSigner();
    await act(() => result.current.signFiles(fileList("a.txt"), "picker"));

    expect(result.current.state.entries[0].status).toEqual({ kind: "failed", message: USER_KEY_REVOKED_MESSAGE });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rotateUserKey).toHaveBeenCalledTimes(1);
  });

  it("shows the revoked message when no new key can be made", async () => {
    getOrCreateUserKey.mockResolvedValue(key(OLD_KEY));
    rotateUserKey.mockRejectedValue(new Error("This browser cannot hold a signing key"));
    const fetchMock = signServer([OLD_KEY]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = await mountSigner();
    await act(() => result.current.signFiles(fileList("a.txt"), "picker"));

    expect(result.current.state.entries[0].status).toEqual({ kind: "failed", message: USER_KEY_REVOKED_MESSAGE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.userKey).toMatchObject({ publicKey: OLD_KEY });
  });
});
