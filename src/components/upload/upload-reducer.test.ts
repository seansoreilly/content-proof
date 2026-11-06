import { describe, expect, it } from "vitest";
import type { SignatureRecord } from "@/lib/record";
import {
  batchCapNote,
  currentEntry,
  initialUploadState,
  MAX_BATCH_FILES,
  selectedEntry,
  uploadReducer,
  type UploadAction,
  type UploadState,
} from "@/components/upload/upload-reducer";

const record = (t: number): SignatureRecord => ({
  v: 2,
  k: "AAAAAAAAAAAAAAAA",
  h: "A".repeat(43),
  e: "a@example.com",
  t,
  s: "B".repeat(86),
});

const files = [
  { name: "a.txt", size: 10, isImage: false },
  { name: "b.png", size: 20, isImage: true },
  { name: "c.txt", size: 30, isImage: false },
];

function run(actions: UploadAction[], from: UploadState = initialUploadState): UploadState {
  return actions.reduce(uploadReducer, from);
}

const started = run([{ type: "batchStarted", run: 1, files, note: null }]);

describe("uploadReducer", () => {
  it("queues every file and selects the first", () => {
    expect(started.running).toBe(true);
    expect(started.entries.map((e) => [e.id, e.name, e.status.kind])).toEqual([
      [0, "a.txt", "queued"],
      [1, "b.png", "queued"],
      [2, "c.txt", "queued"],
    ]);
    expect(selectedEntry(started)?.name).toBe("a.txt");
  });

  it("walks one file through hashing, signing and done", () => {
    const hashing = run(
      [
        { type: "hashStarted", run: 1, id: 0, total: 10 },
        { type: "hashProgress", run: 1, id: 0, done: 4, total: 10 },
      ],
      started,
    );
    expect(hashing.entries[0].status).toEqual({ kind: "hashing", done: 4, total: 10 });
    expect(currentEntry(hashing)?.id).toBe(0);

    const signing = run([{ type: "hashed", run: 1, id: 0, hash: "ab" }], hashing);
    expect(signing.entries[0]).toMatchObject({ hash: "ab", status: { kind: "signing" } });
    expect(currentEntry(signing)?.id).toBe(0);

    const done = run([{ type: "signed", run: 1, id: 0, record: record(1) }], signing);
    expect(done.entries[0].status).toEqual({ kind: "done", record: record(1) });
    expect(currentEntry(done)).toBeNull();
  });

  it("ignores progress for a file that is no longer hashing", () => {
    const state = run(
      [
        { type: "hashStarted", run: 1, id: 0, total: 10 },
        { type: "hashed", run: 1, id: 0, hash: "ab" },
        { type: "hashProgress", run: 1, id: 0, done: 10, total: 10 },
      ],
      started,
    );
    expect(state.entries[0].status).toEqual({ kind: "signing" });
  });

  it("moves the selection to the most recently signed file until one is picked", () => {
    const twoDone = run(
      [
        { type: "signed", run: 1, id: 0, record: record(1) },
        { type: "signed", run: 1, id: 1, record: record(2) },
      ],
      started,
    );
    expect(twoDone.selectedId).toBe(1);

    const picked = run(
      [
        { type: "entrySelected", id: 0 },
        { type: "signed", run: 1, id: 2, record: record(3) },
      ],
      twoDone,
    );
    expect(picked.selectedId).toBe(0);
    expect(picked.pinned).toBe(true);
  });

  it("ignores a selection of an unknown entry", () => {
    expect(uploadReducer(started, { type: "entrySelected", id: 9 })).toBe(started);
  });

  it("records a failed file and carries on", () => {
    const state = run(
      [
        { type: "fileFailed", run: 1, id: 0, message: "The selected file is empty." },
        { type: "hashStarted", run: 1, id: 1, total: 20 },
      ],
      started,
    );
    expect(state.entries[0].status).toEqual({ kind: "failed", message: "The selected file is empty." });
    expect(state.entries[1].status.kind).toBe("hashing");
    expect(state.running).toBe(true);
    expect(state.stopError).toBeNull();
  });

  it("stops the batch: the current file fails and the rest are not signed", () => {
    const state = run(
      [
        { type: "signed", run: 1, id: 0, record: record(1) },
        { type: "hashed", run: 1, id: 1, hash: "cd" },
        { type: "batchStopped", run: 1, id: 1, message: "Too many signing requests.", needsSignIn: false },
      ],
      started,
    );
    expect(state.running).toBe(false);
    expect(state.stopError).toBe("Too many signing requests.");
    expect(state.entries.map((e) => e.status.kind)).toEqual(["done", "failed", "skipped"]);
    expect(state.entries[2].status).toEqual({ kind: "skipped", reason: "Not signed." });
  });

  it("asks for sign-in when a stop needs it", () => {
    const state = run(
      [{ type: "batchStopped", run: 1, id: 0, message: "Please sign in.", needsSignIn: true }],
      started,
    );
    expect(state.needsSignIn).toBe(true);
  });

  it("finishes the batch", () => {
    expect(run([{ type: "batchFinished", run: 1 }], started).running).toBe(false);
  });

  describe("cancel", () => {
    it("returns to a clean idle state when nothing had finished", () => {
      const state = run(
        [
          { type: "hashStarted", run: 1, id: 0, total: 10 },
          { type: "cancelled" },
        ],
        started,
      );
      expect(state).toEqual({ ...initialUploadState, run: 1 });
    });

    it("keeps finished files and marks the rest as not signed", () => {
      const state = run(
        [
          { type: "signed", run: 1, id: 0, record: record(1) },
          { type: "hashStarted", run: 1, id: 1, total: 20 },
          { type: "cancelled" },
        ],
        started,
      );
      expect(state.running).toBe(false);
      expect(state.stopError).toBeNull();
      expect(state.entries.map((e) => e.status.kind)).toEqual(["done", "skipped", "skipped"]);
      expect(state.entries[1].status).toEqual({ kind: "skipped", reason: "Not signed: cancelled." });
      expect(state.selectedId).toBe(0);
    });

    it("does nothing when no batch is running", () => {
      const finished = run([{ type: "batchFinished", run: 1 }], started);
      expect(uploadReducer(finished, { type: "cancelled" })).toBe(finished);
    });
  });

  it("drops events from an earlier or cancelled batch", () => {
    const cancelled = run([{ type: "cancelled" }], started);
    expect(uploadReducer(cancelled, { type: "hashStarted", run: 1, id: 0, total: 10 })).toBe(cancelled);

    const second = run([{ type: "batchStarted", run: 2, files: files.slice(0, 1), note: null }], cancelled);
    expect(uploadReducer(second, { type: "signed", run: 1, id: 0, record: record(1) })).toBe(second);
    expect(uploadReducer(second, { type: "batchFinished", run: 1 })).toBe(second);
  });

  it("clears the previous batch's messages when a new one starts", () => {
    const stopped = run(
      [{ type: "batchStopped", run: 1, id: 0, message: "Please sign in.", needsSignIn: true }],
      started,
    );
    const next = run([{ type: "batchStarted", run: 2, files, note: "note" }], stopped);
    expect(next).toMatchObject({ stopError: null, needsSignIn: false, note: "note", pinned: false, running: true });
  });
});

describe("batchCapNote", () => {
  it("is silent up to the cap and explains it beyond", () => {
    expect(batchCapNote(1)).toBeNull();
    expect(batchCapNote(MAX_BATCH_FILES)).toBeNull();
    expect(batchCapNote(MAX_BATCH_FILES + 5)).toBe(
      `Only the first ${MAX_BATCH_FILES} of ${MAX_BATCH_FILES + 5} files are signed at a time. Add the rest in another batch.`,
    );
  });
});
