/// <reference lib="webworker" />
import { hashBlobStreaming } from "@/lib/hash-stream";

/**
 * Messages from the hashing worker: any number of progress updates, then
 * exactly one `done` or `error`. Cancellation is not a message: the page
 * terminates the worker, which stops the read immediately.
 */
export type HashWorkerResponse =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; hash: string }
  | { type: "error"; message: string };

function reply(message: HashWorkerResponse): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<Blob>): void => {
  hashBlobStreaming(event.data, {
    onProgress: (done, total) => reply({ type: "progress", done, total }),
  })
    .then((hash) => reply({ type: "done", hash }))
    .catch((err: unknown) =>
      reply({ type: "error", message: err instanceof Error ? err.message : "Hashing failed" }),
    );
};
