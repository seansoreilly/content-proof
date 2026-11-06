import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bytesToHex } from "@/lib/base64";
import { MerkleTree, computeRoot, consistencyProof, inclusionProof, leafHash, verifyConsistency, verifyInclusion } from "@/lib/merkle";

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

/**
 * The recursive implementation as it was before the incremental tree, kept
 * verbatim as the reference the new one must match byte for byte.
 */
const reference = (() => {
  const sha = (data: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(data).digest());
  const nodeHash = (l: Uint8Array, r: Uint8Array): Uint8Array => sha(Uint8Array.from([0x01, ...l, ...r]));
  const split = (n: number): number => {
    let k = 1;
    while (k * 2 < n) k *= 2;
    return k;
  };
  const computeRoot = (leaves: Uint8Array[]): Uint8Array => {
    if (leaves.length === 0) return sha(new Uint8Array(0));
    if (leaves.length === 1) return leaves[0];
    const k = split(leaves.length);
    return nodeHash(computeRoot(leaves.slice(0, k)), computeRoot(leaves.slice(k)));
  };
  const inclusionProof = (leaves: Uint8Array[], index: number): Uint8Array[] => {
    if (index < 0 || index >= leaves.length) throw new RangeError("leaf index out of range");
    if (leaves.length === 1) return [];
    const k = split(leaves.length);
    if (index < k) return [...inclusionProof(leaves.slice(0, k), index), computeRoot(leaves.slice(k))];
    return [...inclusionProof(leaves.slice(k), index - k), computeRoot(leaves.slice(0, k))];
  };
  return { computeRoot, inclusionProof };
})();

const hexes = (hashes: Uint8Array[]): string[] => hashes.map(bytesToHex);

describe("incremental Merkle tree", () => {
  const all = Array.from({ length: 70 }, (_, i) => leafHash(utf8(`leaf-${i}`)));

  it("matches the recursive reference root and every audit path for sizes 0 to 70", () => {
    for (let size = 0; size <= 70; size++) {
      const leaves = all.slice(0, size);
      expect(bytesToHex(computeRoot(leaves))).toBe(bytesToHex(reference.computeRoot(leaves)));
      for (let i = 0; i < size; i++) {
        expect(hexes(inclusionProof(leaves, i))).toEqual(hexes(reference.inclusionProof(leaves, i)));
      }
      expect(() => inclusionProof(leaves, size)).toThrow(RangeError);
      expect(() => inclusionProof(leaves, -1)).toThrow(RangeError);
    }
  });

  it("answers for every earlier size from one tree grown leaf by leaf", () => {
    const tree = new MerkleTree();
    for (const leaf of all) tree.append(leaf);
    expect(tree.size).toBe(70);
    for (let size = 0; size <= 70; size++) {
      const leaves = all.slice(0, size);
      expect(bytesToHex(tree.root(size))).toBe(bytesToHex(reference.computeRoot(leaves)));
      for (let i = 0; i < size; i++) {
        expect(hexes(tree.inclusionProof(i, size))).toEqual(hexes(reference.inclusionProof(leaves, i)));
      }
    }
    expect(bytesToHex(tree.leaf(69))).toBe(bytesToHex(all[69]));
    expect(() => tree.root(71)).toThrow(RangeError);
    expect(() => tree.leaf(70)).toThrow(RangeError);
    expect(() => tree.inclusionProof(5, 5)).toThrow(RangeError);
  });

  it("hands out copies, so callers cannot corrupt the cached nodes", () => {
    const tree = MerkleTree.from(all.slice(0, 8));
    const before = bytesToHex(tree.root());
    tree.root().fill(0);
    tree.leaf(0).fill(0);
    tree.inclusionProof(3)[0].fill(0);
    expect(bytesToHex(tree.root())).toBe(before);
  });

  it("refuses leaves that are not 32-byte hashes", () => {
    expect(() => new MerkleTree().append(new Uint8Array(31))).toThrow(RangeError);
  });
});

describe("RFC 6962 consistency proofs", () => {
  const all = Array.from({ length: 40 }, (_, i) => leafHash(utf8(`leaf-${i}`)));
  const tree = MerkleTree.from(all);
  const empty = computeRoot([]);

  it("verifies for every 0 <= m <= n <= 40 and matches the pure function", () => {
    for (let n = 0; n <= 40; n++) {
      const newRoot = tree.root(n);
      for (let m = 0; m <= n; m++) {
        const oldRoot = tree.root(m);
        const proof = consistencyProof(all, m, n);
        expect(hexes(proof)).toEqual(hexes(tree.consistencyProof(m, n)));
        if (m === 0 || m === n) expect(proof).toEqual([]);
        expect(verifyConsistency(m, n, oldRoot, newRoot, proof), `${m}->${n}`).toBe(true);
      }
    }
  });

  it("rejects tampered proofs, roots and sizes", () => {
    for (let n = 2; n <= 40; n++) {
      const newRoot = tree.root(n);
      for (let m = 1; m < n; m++) {
        const oldRoot = tree.root(m);
        const proof = tree.consistencyProof(m, n);
        const label = `${m}->${n}`;
        expect(proof.length, label).toBeGreaterThan(0);
        for (let i = 0; i < proof.length; i++) {
          const flipped = proof.map((p) => p.slice());
          flipped[i][0] ^= 1;
          expect(verifyConsistency(m, n, oldRoot, newRoot, flipped), label).toBe(false);
        }
        expect(verifyConsistency(m, n, oldRoot, newRoot, proof.slice(1)), label).toBe(false);
        expect(verifyConsistency(m, n, oldRoot, newRoot, proof.slice(0, -1)), label).toBe(false);
        expect(verifyConsistency(m, n, oldRoot, newRoot, [...proof, newRoot]), label).toBe(false);
        expect(verifyConsistency(m, n, newRoot, oldRoot, proof), label).toBe(false);
        expect(verifyConsistency(m, n, tree.root(m - 1), newRoot, proof), label).toBe(false);
        expect(verifyConsistency(m, n, oldRoot, tree.root(n - 1), proof), label).toBe(false);
        const wrongM = m + 1 < n ? m + 1 : m - 1;
        expect(verifyConsistency(wrongM, n, oldRoot, newRoot, proof), label).toBe(false);
        expect(verifyConsistency(n, m, newRoot, oldRoot, proof), label).toBe(false);
      }
    }
  });

  it("treats equal sizes and the empty tree as trivially consistent, and nothing else", () => {
    const root5 = tree.root(5);
    expect(verifyConsistency(5, 5, root5, root5, [])).toBe(true);
    expect(verifyConsistency(5, 5, root5, tree.root(6), [])).toBe(false);
    expect(verifyConsistency(5, 5, root5, root5, [root5])).toBe(false);
    expect(verifyConsistency(0, 7, empty, tree.root(7), [])).toBe(true);
    expect(verifyConsistency(0, 0, empty, empty, [])).toBe(true);
    expect(verifyConsistency(0, 7, root5, tree.root(7), [])).toBe(false);
    expect(verifyConsistency(0, 7, empty, tree.root(7), [root5])).toBe(false);
    expect(verifyConsistency(3, 7, tree.root(3), tree.root(7), [])).toBe(false);
  });

  it("rejects invalid sizes instead of throwing", () => {
    const r = tree.root(4);
    for (const [m, n] of [[5, 4], [-1, 4], [1.5, 4], [1, Number.NaN], [1, 2 ** 40]]) {
      expect(verifyConsistency(m, n, r, r, [r])).toBe(false);
    }
    expect(() => consistencyProof(all, 5, 4)).toThrow(RangeError);
    expect(() => consistencyProof(all, -1, 4)).toThrow(RangeError);
    expect(() => consistencyProof(all, 1, 41)).toThrow(RangeError);
    expect(() => tree.consistencyProof(2, 41)).toThrow(RangeError);
  });
});
