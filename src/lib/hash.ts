import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Upper bound enforced by the upload UI. Hashing is streamed, so this is a
 * guard against pathological inputs rather than a memory limit.
 */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/**
 * SHA-256 of a Blob/File as lowercase hex, computed incrementally from the
 * blob's stream so large files never have to be fully buffered in memory.
 */
export async function sha256Hash(file: Blob): Promise<string> {
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
