import { describe, expect, it } from "vitest";
import { MAX_FILE_SIZE_BYTES, sha256Hash } from "@/lib/hash";
import { sha256Hex } from "@/test/fixtures";

describe("browser file hashing", () => {
  it("matches node's SHA-256 for a small file", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const file = new File([bytes], "hello.txt", { type: "text/plain" });
    expect(await sha256Hash(file)).toBe(sha256Hex(bytes));
  });

  it("hashes a multi-megabyte file in chunks without loading it whole", async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 17);
    for (let i = 0; i < big.length; i += 4096) big[i] = i & 0xff;
    const file = new File([big], "big.bin");
    expect(await sha256Hash(file)).toBe(sha256Hex(big));
  });

  it("allows files far larger than the old 10MB cap", () => {
    expect(MAX_FILE_SIZE_BYTES).toBeGreaterThanOrEqual(500 * 1024 * 1024);
  });
});
