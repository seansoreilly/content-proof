import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * SHA-256 of a Blob/File as lowercase hex, computed incrementally from the
 * blob's stream so large files never have to be fully buffered in memory.
 * Shared by the main-thread fallback and the hashing worker.
 */
export async function hashBlobStreaming(file: Blob): Promise<string> {
  const hasher = sha256.create();

  if (typeof file.stream === "function") {
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
  } else {
    hasher.update(new Uint8Array(await file.arrayBuffer()));
  }

  return bytesToHex(hasher.digest());
}
