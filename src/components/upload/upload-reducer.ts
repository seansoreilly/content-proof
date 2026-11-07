import type { SignatureRecord } from "@/lib/record";

/**
 * At most this many files are signed per drop or pick. Files go one at a time
 * to respect the signing rate limit (30 a minute), so a cap keeps a careless
 * "select all" from tying up the page and the account's allowance.
 */
export const MAX_BATCH_FILES = 20;

export type EntryStatus =
  | { kind: "queued" }
  | { kind: "hashing"; done: number; total: number }
  | { kind: "signing" }
  /** `logged` is false when the service could not store or log the record. */
  | { kind: "done"; record: SignatureRecord; logged: boolean }
  | { kind: "failed"; message: string }
  /** Never attempted because the batch stopped or was cancelled first. */
  | { kind: "skipped"; reason: string };

export interface UploadEntry {
  /** Position in the batch; unique within it. */
  id: number;
  name: string;
  size: number;
  isImage: boolean;
  hash: string | null;
  status: EntryStatus;
}

export interface UploadState {
  /** Identifies the batch in flight; actions from an older batch are ignored. */
  run: number;
  running: boolean;
  entries: UploadEntry[];
  /** The entry whose details, preview and seal are shown. */
  selectedId: number | null;
  /** Set once the person picks an entry, so finishing files stop moving the selection. */
  pinned: boolean;
  /** Why the batch stopped early (signed out, rate limited). */
  stopError: string | null;
  needsSignIn: boolean;
  note: string | null;
}

export interface NewEntry {
  name: string;
  size: number;
  isImage: boolean;
}

export type UploadAction =
  | { type: "batchStarted"; run: number; files: NewEntry[]; note: string | null }
  | { type: "hashStarted"; run: number; id: number; total: number }
  | { type: "hashProgress"; run: number; id: number; done: number; total: number }
  | { type: "hashed"; run: number; id: number; hash: string }
  | { type: "signed"; run: number; id: number; record: SignatureRecord; logged: boolean }
  | { type: "fileFailed"; run: number; id: number; message: string }
  | { type: "batchStopped"; run: number; id: number; message: string; needsSignIn: boolean }
  | { type: "batchFinished"; run: number }
  | { type: "cancelled" }
  | { type: "entrySelected"; id: number };

export const initialUploadState: UploadState = {
  run: 0,
  running: false,
  entries: [],
  selectedId: null,
  pinned: false,
  stopError: null,
  needsSignIn: false,
  note: null,
};

/** The note shown when more files were chosen than one batch takes. */
export function batchCapNote(chosen: number): string | null {
  if (chosen <= MAX_BATCH_FILES) return null;
  return `Only the first ${MAX_BATCH_FILES} of ${chosen} files are signed at a time. Add the rest in another batch.`;
}

const NOT_SIGNED = "Not signed";

function isUnfinished(entry: UploadEntry): boolean {
  const kind = entry.status.kind;
  return kind === "queued" || kind === "hashing" || kind === "signing";
}

function updateEntry(state: UploadState, id: number, update: (entry: UploadEntry) => UploadEntry): UploadState {
  return { ...state, entries: state.entries.map((entry) => (entry.id === id ? update(entry) : entry)) };
}

/**
 * State for signing a batch of files one after another. Pure, so the order of
 * events (progress after a cancel, a stale batch finishing late) is tested
 * without a browser; the component owns the files, the fetches and analytics.
 */
export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case "batchStarted":
      return {
        ...initialUploadState,
        run: action.run,
        running: true,
        entries: action.files.map((file, id) => ({ ...file, id, hash: null, status: { kind: "queued" } })),
        // Show the first file straight away, as a single upload always did.
        selectedId: action.files.length > 0 ? 0 : null,
        note: action.note,
      };
    case "entrySelected":
      if (!state.entries.some((entry) => entry.id === action.id)) return state;
      return { ...state, selectedId: action.id, pinned: true };
    case "cancelled": {
      if (!state.running) return state;
      // Nothing finished: back to a clean idle page, exactly as before the drop.
      if (state.entries.every(isUnfinished)) return { ...initialUploadState, run: state.run };
      return {
        ...state,
        running: false,
        entries: state.entries.map((entry) =>
          isUnfinished(entry) ? { ...entry, status: { kind: "skipped", reason: `${NOT_SIGNED}: cancelled.` } } : entry,
        ),
      };
    }
  }

  // Everything below belongs to one batch; a late event from an earlier one is dropped.
  if (action.run !== state.run || !state.running) return state;

  switch (action.type) {
    case "hashStarted":
      return updateEntry(state, action.id, (entry) => ({
        ...entry,
        status: { kind: "hashing", done: 0, total: action.total },
      }));
    case "hashProgress":
      return updateEntry(state, action.id, (entry) =>
        entry.status.kind === "hashing"
          ? { ...entry, status: { kind: "hashing", done: action.done, total: action.total } }
          : entry,
      );
    case "hashed":
      return updateEntry(state, action.id, (entry) => ({ ...entry, hash: action.hash, status: { kind: "signing" } }));
    case "signed": {
      const next = updateEntry(state, action.id, (entry) => ({
        ...entry,
        status: { kind: "done", record: action.record, logged: action.logged },
      }));
      return state.pinned ? next : { ...next, selectedId: action.id };
    }
    case "fileFailed":
      return updateEntry(state, action.id, (entry) => ({
        ...entry,
        status: { kind: "failed", message: action.message },
      }));
    case "batchStopped":
      return {
        ...state,
        running: false,
        stopError: action.message,
        needsSignIn: action.needsSignIn,
        entries: state.entries.map((entry) => {
          if (entry.id === action.id) return { ...entry, status: { kind: "failed", message: action.message } };
          if (entry.status.kind === "queued") return { ...entry, status: { kind: "skipped", reason: `${NOT_SIGNED}.` } };
          return entry;
        }),
      };
    case "batchFinished":
      return { ...state, running: false };
  }
}

/** The entry currently being hashed or signed, if any. */
export function currentEntry(state: UploadState): UploadEntry | null {
  return state.entries.find((entry) => entry.status.kind === "hashing" || entry.status.kind === "signing") ?? null;
}

/** The entry whose details are shown. */
export function selectedEntry(state: UploadState): UploadEntry | null {
  return state.entries.find((entry) => entry.id === state.selectedId) ?? null;
}
