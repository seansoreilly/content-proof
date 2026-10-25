/// <reference lib="webworker" />
import { hashBlobStreaming } from "@/lib/hash-stream";

export type HashWorkerResponse = { ok: true; hash: string } | { ok: false; message: string };

self.onmessage = (event: MessageEvent<Blob>): void => {
  hashBlobStreaming(event.data)
    .then((hash) => {
      const reply: HashWorkerResponse = { ok: true, hash };
      self.postMessage(reply);
    })
    .catch((err: unknown) => {
      const reply: HashWorkerResponse = {
        ok: false,
        message: err instanceof Error ? err.message : "Hashing failed",
      };
      self.postMessage(reply);
    });
};
