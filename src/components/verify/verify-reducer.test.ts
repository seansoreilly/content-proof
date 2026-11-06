import { describe, expect, it } from "vitest";
import type { PublicKeysLoad } from "@/lib/keyset-client";
import type { LoadedInput } from "@/lib/verify-input";
import {
  canVerify,
  endsRun,
  FILE_TOO_LARGE,
  initialVerifyState,
  LEGACY_EMAIL_MISSING,
  verifyReducer,
  type VerifyAction,
  type VerifyState,
} from "@/components/verify/verify-reducer";
import { MAX_FILE_SIZE_BYTES } from "@/lib/hash";

const loaded: LoadedInput = {
  kind: "record",
  record: { v: 2, k: "AAAAAAAAAAAAAAAA", h: "h", e: "a@example.com", t: 1, s: "s" },
};
const legacy: LoadedInput = { kind: "legacy", payload: { signature: "s", publicKey: "p", timestamp: 1 } };
const keys = { keys: { keys: [] }, source: "network" } as unknown as PublicKeysLoad;
const file = new File(["hello"], "a.txt");

function run(state: VerifyState, ...actions: VerifyAction[]): VerifyState {
  return actions.reduce(verifyReducer, state);
}

/** A record, a file and keys, ready to check. */
const ready = run(
  initialVerifyState,
  { type: "keysLoaded", keys },
  { type: "recordLoaded", loaded },
  { type: "fileChosen", file },
);

const success = { ok: true, keyId: "k", userSigned: false };

describe("verifyReducer", () => {
  it("can verify only with a record, a file and keys, and not while hashing", () => {
    expect(canVerify(initialVerifyState)).toBe(false);
    expect(canVerify(ready)).toBe(true);
    const hashing = run(ready, { type: "verifyStarted", run: 1, total: 5 });
    expect(hashing.phase).toEqual({ kind: "hashing", done: 0, total: 5 });
    expect(canVerify(hashing)).toBe(false);
  });

  it("tracks progress for the current run", () => {
    const s = run(ready, { type: "verifyStarted", run: 1, total: 100 }, { type: "hashProgress", run: 1, done: 40, total: 100 });
    expect(s.phase).toEqual({ kind: "hashing", done: 40, total: 100 });
  });

  it("finishes a run and then accepts its log status", () => {
    const s = run(
      ready,
      { type: "verifyStarted", run: 1, total: 5 },
      { type: "verified", run: 1, result: success, subject: { email: "a@example.com", attestedMs: 1 }, checkLog: true },
    );
    expect(s.phase).toEqual({ kind: "done", result: success, subject: { email: "a@example.com", attestedMs: 1 } });
    expect(s.logStatus).toEqual({ kind: "checking" });
    // The log check lands after `done`, so finishing must not end the run.
    const after = verifyReducer(s, { type: "logChecked", run: 1, status: { kind: "absent" } });
    expect(after.logStatus).toEqual({ kind: "absent" });
  });

  it("ignores results from an earlier run", () => {
    const started = run(ready, { type: "verifyStarted", run: 1, total: 5 }, { type: "verifyStarted", run: 2, total: 5 });
    const stale: VerifyAction[] = [
      { type: "hashProgress", run: 1, done: 3, total: 5 },
      { type: "verified", run: 1, result: success, subject: { email: "x", attestedMs: 1 }, checkLog: true },
      { type: "verifyFailed", run: 1 },
      { type: "logChecked", run: 1, status: { kind: "invalid" } },
    ];
    for (const action of stale) expect(verifyReducer(started, action)).toBe(started);
  });

  it("drops a late log status once the file changes", () => {
    const done = run(
      ready,
      { type: "verifyStarted", run: 1, total: 5 },
      { type: "verified", run: 1, result: success, subject: { email: "a@example.com", attestedMs: 1 }, checkLog: true },
      { type: "fileChosen", file: new File(["other"], "b.txt") },
    );
    expect(done.phase).toEqual({ kind: "idle" });
    expect(done.logStatus).toBeNull();
    expect(verifyReducer(done, { type: "logChecked", run: 1, status: { kind: "absent" } })).toBe(done);
  });

  it("returns to idle with no error when cancelled", () => {
    const s = run(ready, { type: "verifyStarted", run: 1, total: 5 }, { type: "cancelled" });
    expect(s.phase).toEqual({ kind: "idle" });
    expect(s.run).toBeNull();
    expect(s.inputError ?? s.fileError ?? s.keysError).toBeNull();
    expect(s.file).toBe(file);
    expect(canVerify(s)).toBe(true);
    // The aborted hash's progress cannot revive it.
    expect(verifyReducer(s, { type: "hashProgress", run: 1, done: 4, total: 5 })).toBe(s);
  });

  it("marks a thrown check as malformed", () => {
    const s = run(ready, { type: "verifyStarted", run: 1, total: 5 }, { type: "verifyFailed", run: 1 });
    expect(s.phase).toMatchObject({ kind: "done", result: { ok: false, reason: "malformed" } });
  });

  it("rejects a file over the size limit and remounts the input", () => {
    const big = { size: MAX_FILE_SIZE_BYTES + 1 } as File;
    const s = verifyReducer(ready, { type: "fileChosen", file: big });
    expect(s.file).toBeNull();
    expect(s.fileError).toBe(FILE_TOO_LARGE);
    expect(s.fileInputKey).toBe(ready.fileInputKey + 1);
    // A later valid selection clears the file error.
    expect(verifyReducer(s, { type: "fileChosen", file }).fileError).toBeNull();
  });

  it("clears the record, the paste box and the error together", () => {
    const s = run(
      ready,
      { type: "manualInputChanged", text: "junk" },
      { type: "inputRejected", message: "bad" },
      { type: "recordCleared" },
    );
    expect(s).toMatchObject({ loaded: null, manualInput: "", inputError: null, phase: { kind: "idle" } });
  });

  it("keeps a loaded record when pasted text is rejected, but drops it for a bad link", () => {
    expect(verifyReducer(ready, { type: "inputRejected", message: "bad" }).loaded).toBe(loaded);
    const link = verifyReducer(ready, { type: "linkRejected", message: "The verification link is not valid." });
    expect(link.loaded).toBeNull();
    expect(link.inputError).toBe("The verification link is not valid.");
  });

  it("asks for the signer's address on a legacy record", () => {
    const s = run(ready, { type: "recordLoaded", loaded: legacy }, { type: "legacyEmailMissing" });
    expect(s.inputError).toBe(LEGACY_EMAIL_MISSING);
    expect(s.phase).toEqual({ kind: "idle" });
  });

  it("fills the legacy email from the session only when it is empty", () => {
    expect(verifyReducer(initialVerifyState, { type: "legacyEmailDefaulted", email: "me@x" }).legacyEmail).toBe("me@x");
    const typed = verifyReducer(initialVerifyState, { type: "legacyEmailChanged", email: "typed@x" });
    expect(verifyReducer(typed, { type: "legacyEmailDefaulted", email: "me@x" }).legacyEmail).toBe("typed@x");
  });

  it("ends the run on exactly the actions that change the record or file, or cancel", () => {
    const running = run(ready, { type: "verifyStarted", run: 7, total: 5 });
    const actions: VerifyAction[] = [
      { type: "recordLoaded", loaded },
      { type: "linkRejected", message: "m" },
      { type: "recordCleared" },
      { type: "fileChosen", file },
      { type: "fileCleared" },
      { type: "legacyEmailMissing" },
      { type: "cancelled" },
      { type: "manualInputChanged", text: "t" },
      { type: "legacyEmailChanged", email: "e" },
      { type: "inputRejected", message: "m" },
      { type: "qrDecodeStarted" },
      { type: "qrDecodeFinished" },
      { type: "keysLoaded", keys },
    ];
    for (const action of actions) {
      expect(verifyReducer(running, action).run === null, action.type).toBe(endsRun(action));
    }
  });
});
