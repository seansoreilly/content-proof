import { describe, expect, it, vi } from "vitest";
import { hashBlobStreaming, isAbortError } from "@/lib/hash-stream";
import { sha256Hash } from "@/lib/hash";
import { sha256Hex } from "@/test/fixtures";

const MB = 1024 * 1024;

/** Several separate parts, so the stream yields many chunks however Node sizes them. */
function multiPartBlob(parts: number, partSize: number): { blob: Blob; bytes: Uint8Array } {
  const chunks: Uint8Array[] = [];
  for (let p = 0; p < parts; p++) {
    const chunk = new Uint8Array(partSize);
    for (let i = 0; i < partSize; i += 1024) chunk[i] = (p * 31 + i) & 0xff;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(parts * partSize);
  chunks.forEach((c, i) => bytes.set(c, i * partSize));
  return { blob: new Blob(chunks as BlobPart[]), bytes };
}

describe("hashBlobStreaming progress", () => {
  it("reports monotonic progress that ends at the full size, and still hashes correctly", async () => {
    const { blob, bytes } = multiPartBlob(6, MB);
    const calls: Array<[number, number]> = [];
    const hash = await hashBlobStreaming(blob, { onProgress: (done, total) => calls.push([done, total]) });

    expect(hash).toBe(sha256Hex(bytes));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
    expect(calls.every(([, total]) => total === blob.size)).toBe(true);
    expect(calls.at(-1)).toEqual([blob.size, blob.size]);
  });

  it("throttles to roughly one update per percent", async () => {
    // 200 parts of 16 KiB: each part is 0.5% of the total, so at most ~100 updates plus the last.
    const { blob } = multiPartBlob(200, 16 * 1024);
    const onProgress = vi.fn();
    await hashBlobStreaming(blob, { onProgress });
    expect(onProgress.mock.calls.length).toBeLessThanOrEqual(102);
    expect(onProgress).toHaveBeenLastCalledWith(blob.size, blob.size);
  });

  it("reports completion for an empty blob", async () => {
    const onProgress = vi.fn();
    await hashBlobStreaming(new Blob([]), { onProgress });
    expect(onProgress).toHaveBeenCalledWith(0, 0);
  });
});

describe("hashBlobStreaming cancellation", () => {
  it("rejects with an AbortError when aborted mid-stream", async () => {
    const { blob } = multiPartBlob(8, MB);
    const controller = new AbortController();
    const onProgress = vi.fn(() => controller.abort());
    const err = await hashBlobStreaming(blob, { onProgress, signal: controller.signal }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
    expect(isAbortError(err)).toBe(true);
    // Stopped after the first update rather than reading the rest of the file.
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("rejects immediately, without reading, when the signal is already aborted", async () => {
    const { blob } = multiPartBlob(2, MB);
    const controller = new AbortController();
    controller.abort();
    const onProgress = vi.fn();
    await expect(hashBlobStreaming(blob, { onProgress, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("is honoured by sha256Hash, the public entry point", async () => {
    const { blob } = multiPartBlob(4, MB);
    const controller = new AbortController();
    controller.abort();
    await expect(sha256Hash(blob, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    const live = new AbortController();
    const onProgress = vi.fn(() => live.abort());
    await expect(sha256Hash(blob, { signal: live.signal, onProgress })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("does not flag ordinary errors as aborts", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
