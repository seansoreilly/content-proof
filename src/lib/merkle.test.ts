import { describe, expect, it } from "vitest";
import { bytesToHex } from "@/lib/base64";
import { computeRoot, inclusionProof, leafHash, verifyInclusion } from "@/lib/merkle";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("RFC 6962 Merkle tree", () => {
  it("matches the RFC 6962 empty tree and single-leaf vectors", () => {
    // SHA-256 of the empty string
    expect(bytesToHex(computeRoot([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    // MTH({""}) = SHA-256(0x00) from RFC 6962 §2.1.1 test vectors
    expect(bytesToHex(computeRoot([leafHash(utf8(""))]))).toBe(
      "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d"
    );
  });

  it("matches the RFC 6962 eight-leaf root", () => {
    const inputs = ["", "\x00", "\x10", "\x20\x21", "\x30\x31", "\x40\x41\x42\x43", "\x50\x51\x52\x53\x54\x55\x56\x57", "\x60\x61\x62\x63\x64\x65\x66\x67\x68\x69\x6a\x6b\x6c\x6d\x6e\x6f"];
    const leaves = inputs.map((s) => leafHash(Uint8Array.from(s, (c) => c.charCodeAt(0))));
    expect(bytesToHex(computeRoot(leaves))).toBe(
      "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328"
    );
  });

  it("produces inclusion proofs that verify for every leaf of every size up to 17", () => {
    for (let size = 1; size <= 17; size++) {
      const leaves = Array.from({ length: size }, (_, i) => leafHash(utf8(`entry-${i}`)));
      const root = computeRoot(leaves);
      for (let i = 0; i < size; i++) {
        const proof = inclusionProof(leaves, i);
        expect(verifyInclusion(leaves[i], i, size, proof, root)).toBe(true);
        // wrong leaf, wrong index and truncated proof must all fail
        expect(verifyInclusion(leafHash(utf8("other")), i, size, proof, root)).toBe(false);
        if (size > 1) {
          expect(verifyInclusion(leaves[i], (i + 1) % size, size, proof, root)).toBe(false);
          expect(verifyInclusion(leaves[i], i, size, proof.slice(1), root)).toBe(false);
        }
      }
    }
  });
});
