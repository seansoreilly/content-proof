import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Options shared by every hashing entry point. */
export interface HashOptions {
  /** Called as bytes are consumed, roughly every 1% or 100 ms, and once at the end. */
  onProgress?: (bytesDone: number, total: number) => void;
  /** Aborting stops reading the file and rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** The rejection a cancelled hash produces, the same shape `fetch` uses. */
export function abortError(): DOMException {
  return new DOMException("Hashing was cancelled", "AbortError");
}

/**
 * True for the rejection of a cancelled hash. Checked by name rather than
 * `instanceof`, because the error may have been created in another realm.
 */
export function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

const PROGRESS_INTERVAL_MS = 100;

/**
 * Throttles progress so a large stream of small chunks does not flood the
 * main thread (or the worker's message port) with updates nobody can see.
 * The final call always goes through so a bar can reach 100%.
 */
function progressReporter(total: number, onProgress: HashOptions["onProgress"]): (done: number) => void {
  if (!onProgress) return () => {};
  const step = total / 100;
  let lastDone = 0;
  let lastTime = Date.now();
  return (done) => {
    const now = Date.now();
    if (done === total || done - lastDone >= step || now - lastTime >= PROGRESS_INTERVAL_MS) {
      lastDone = done;
      lastTime = now;
      onProgress(done, total);
    }
  };
}

/**
 * SHA-256 of a Blob/File as lowercase hex, computed incrementally from the
 * blob's stream so large files never have to be fully buffered in memory.
 * Shared by the main-thread fallback and the hashing worker.
 */
export async function hashBlobStreaming(file: Blob, options: HashOptions = {}): Promise<string> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  const hasher = sha256.create();
  const total = file.size;
  const report = progressReporter(total, options.onProgress);

  if (typeof file.stream === "function") {
    const reader = file.stream().getReader();
    // Cancelling the reader settles a pending read, so an abort takes effect
    // without waiting for the next chunk to arrive.
    const onAbort = (): void => {
      reader.cancel().catch(() => {});
    };
    signal?.addEventListener("abort", onAbort);
    try {
      let done = 0;
      for (;;) {
        const chunk = await reader.read();
        if (signal?.aborted) throw abortError();
        if (chunk.done) break;
        hasher.update(chunk.value);
        done += chunk.value.byteLength;
        report(done);
      }
      // An empty blob yields no chunks; still say it is finished.
      if (done !== total || total === 0) report(total);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (signal?.aborted) throw abortError();
    hasher.update(bytes);
    report(total);
  }

  return bytesToHex(hasher.digest());
}
