import { hashBlobStreaming } from "@/lib/hash-stream";
import type { HashWorkerResponse } from "@/lib/hash.worker";

/**
 * Upper bound enforced by the upload UI. Hashing is streamed, so this is a
 * guard against pathological inputs rather than a memory limit.
 */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/**
 * Hash in a module Web Worker so a large file does not freeze the page.
 * Rejects if the worker cannot start or fails, so the caller can fall back.
 */
function hashInWorker(file: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Worker unavailable"));
      return;
    }
    worker.onmessage = (event: MessageEvent<HashWorkerResponse>): void => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.hash);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event: ErrorEvent): void => {
      worker.terminate();
      reject(new Error(event.message || "Hash worker failed"));
    };
    worker.postMessage(file);
  });
}

/**
 * SHA-256 of a Blob/File as lowercase hex. Runs in a Web Worker where
 * available, otherwise (Node, tests, a worker that fails to start) streams on
 * the calling thread.
 */
export async function sha256Hash(file: Blob): Promise<string> {
  if (typeof Worker !== "undefined") {
    try {
      return await hashInWorker(file);
    } catch (err) {
      console.warn("Hash worker unavailable, hashing on the main thread", err);
    }
  }
  return hashBlobStreaming(file);
}
