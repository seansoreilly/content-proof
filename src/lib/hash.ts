import { abortError, hashBlobStreaming, isAbortError, type HashOptions } from "@/lib/hash-stream";
import type { HashWorkerResponse } from "@/lib/hash.worker";

export { isAbortError, type HashOptions } from "@/lib/hash-stream";

/**
 * Upper bound enforced by the upload UI. Hashing is streamed, so this is a
 * guard against pathological inputs rather than a memory limit.
 */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/** The limit as shown to people, e.g. "500 MB". */
export const MAX_FILE_SIZE_LABEL = `${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB`;

/**
 * Hash in a module Web Worker so a large file does not freeze the page.
 * Rejects if the worker cannot start or fails, so the caller can fall back.
 * An abort terminates the worker and rejects with an `AbortError`, which is
 * not a reason to fall back.
 */
function hashInWorker(file: Blob, { onProgress, signal }: HashOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Worker unavailable"));
      return;
    }
    const onAbort = (): void => {
      finish();
      reject(abortError());
    };
    const finish = (): void => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = (event: MessageEvent<HashWorkerResponse>): void => {
      const data = event.data;
      if (data.type === "progress") {
        onProgress?.(data.done, data.total);
        return;
      }
      finish();
      if (data.type === "done") resolve(data.hash);
      else reject(new Error(data.message));
    };
    worker.onerror = (event: ErrorEvent): void => {
      finish();
      reject(new Error(event.message || "Hash worker failed"));
    };
    worker.postMessage(file);
  });
}

/**
 * SHA-256 of a Blob/File as lowercase hex. Runs in a Web Worker where
 * available, otherwise (Node, tests, a worker that fails to start) streams on
 * the calling thread. Progress goes to `onProgress`; aborting `signal`
 * rejects with an `AbortError`.
 */
export async function sha256Hash(file: Blob, options: HashOptions = {}): Promise<string> {
  if (options.signal?.aborted) throw abortError();
  if (typeof Worker !== "undefined") {
    try {
      return await hashInWorker(file, options);
    } catch (err) {
      // Cancelling is the caller's choice, not a broken worker.
      if (isAbortError(err)) throw err;
      console.warn("Hash worker unavailable, hashing on the main thread", err);
    }
  }
  return hashBlobStreaming(file, options);
}
