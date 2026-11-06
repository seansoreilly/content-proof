import { sha256 } from "@noble/hashes/sha2.js";

/**
 * RFC 6962 / RFC 9162 Merkle tree over an append-only log. Domain-separated
 * hashing (0x00 for leaves, 0x01 for interior nodes) prevents second-preimage
 * tricks between leaves and nodes. Environment-agnostic so a verifier in the
 * browser can check an inclusion proof against a published tree head.
 */
const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;
const HASH_LENGTH = 32;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function leafHash(data: Uint8Array): Uint8Array {
  return sha256(concat(Uint8Array.of(LEAF_PREFIX), data));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(Uint8Array.of(NODE_PREFIX), left, right));
}

/** Largest power of two strictly less than n (n >= 2). */
function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function log2(n: number): number {
  return 31 - Math.clz32(n);
}

/** Sizes are used with 32-bit shifts, both here and in the verifiers. */
const MAX_TREE_SIZE = 0x7fffffff;

function isTreeSize(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_TREE_SIZE;
}

/**
 * An append-only RFC 6962 tree that keeps the root of every complete,
 * aligned power-of-two subtree, level by level, in flat buffers (32 bytes per
 * node, about 64 bytes per leaf in all, up to twice that just after a buffer
 * doubles). Those subtrees never change once
 * complete, and the RFC's recursive split always puts one on the left, so a
 * root or audit path for any tree size up to `size` needs O(log n) hashes
 * (O(log² n) for an audit path) instead of a pass over every leaf. Appending a leaf
 * costs at most log n hashes.
 */
export class MerkleTree {
  /** levels[k] holds the roots of the aligned subtrees of 2^k leaves. */
  private levels: Uint8Array[] = [];
  private counts: number[] = [];

  static from(leaves: Uint8Array[]): MerkleTree {
    const tree = new MerkleTree();
    for (const leaf of leaves) tree.append(leaf);
    return tree;
  }

  get size(): number {
    return this.counts[0] ?? 0;
  }

  append(leaf: Uint8Array): void {
    if (leaf.length !== HASH_LENGTH) throw new RangeError("leaf hash must be 32 bytes");
    let hash = leaf;
    for (let level = 0; ; level++) {
      const index = this.push(level, hash);
      // A right child completes its parent; a left child waits for a sibling.
      if ((index & 1) === 0) return;
      hash = nodeHash(this.node(level, index - 1), hash);
    }
  }

  /** Leaf hash at `index`. */
  leaf(index: number): Uint8Array {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) throw new RangeError("leaf index out of range");
    return this.node(0, index).slice();
  }

  /** MTH of the first `size` leaves (RFC 6962 §2.1). */
  root(size: number = this.size): Uint8Array {
    this.checkSize(size);
    if (size === 0) return sha256(new Uint8Array(0));
    return this.rangeRoot(0, size).slice();
  }

  /** PATH(index, D[0:size]) (RFC 6962 §2.1.1). */
  inclusionProof(index: number, size: number = this.size): Uint8Array[] {
    this.checkSize(size);
    if (!Number.isInteger(index) || index < 0 || index >= size) throw new RangeError("leaf index out of range");
    return this.path(index, 0, size).map((h) => h.slice());
  }

  private checkSize(size: number): void {
    if (!isTreeSize(size) || size > this.size) throw new RangeError("tree size out of range");
  }

  private push(level: number, hash: Uint8Array): number {
    const count = this.counts[level] ?? 0;
    let buffer = this.levels[level];
    if (!buffer || (count + 1) * HASH_LENGTH > buffer.length) {
      const grown = new Uint8Array(Math.max(16, count * 2) * HASH_LENGTH);
      if (buffer) grown.set(buffer);
      buffer = grown;
      this.levels[level] = buffer;
    }
    buffer.set(hash, count * HASH_LENGTH);
    this.counts[level] = count + 1;
    return count;
  }

  /** A view into the level buffer; callers copy before handing it out. */
  private node(level: number, index: number): Uint8Array {
    return this.levels[level].subarray(index * HASH_LENGTH, (index + 1) * HASH_LENGTH);
  }

  /** MTH(D[start:end]) for a non-empty range. */
  private rangeRoot(start: number, end: number): Uint8Array {
    const n = end - start;
    if (isPowerOfTwo(n) && start % n === 0) return this.node(log2(n), start / n);
    const k = split(n);
    return nodeHash(this.rangeRoot(start, start + k), this.rangeRoot(start + k, end));
  }

  private path(index: number, start: number, end: number): Uint8Array[] {
    const n = end - start;
    if (n === 1) return [];
    const k = split(n);
    if (index < start + k) return [...this.path(index, start, start + k), this.rangeRoot(start + k, end)];
    return [...this.path(index, start + k, end), this.rangeRoot(start, start + k)];
  }

}

/** Merkle tree hash of the given leaf hashes (MTH in RFC 6962 §2.1). */
export function computeRoot(leaves: Uint8Array[]): Uint8Array {
  return MerkleTree.from(leaves).root();
}

/** Audit path for leaf `index` (PATH in RFC 6962 §2.1.1). */
export function inclusionProof(leaves: Uint8Array[], index: number): Uint8Array[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new RangeError("leaf index out of range");
  return MerkleTree.from(leaves).inclusionProof(index);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Verify an audit path (RFC 9162 §2.1.3.2). */
export function verifyInclusion(
  leaf: Uint8Array,
  index: number,
  treeSize: number,
  proof: Uint8Array[],
  root: Uint8Array
): boolean {
  if (index < 0 || index >= treeSize) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      r = nodeHash(p, r);
      if ((fn & 1) === 0) {
        while (!((fn & 1) === 1 || fn === 0)) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && equal(r, root);
}
