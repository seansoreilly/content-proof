import { sha256 } from "@noble/hashes/sha2.js";

/**
 * RFC 6962 / RFC 9162 Merkle tree over an append-only log. Domain-separated
 * hashing (0x00 for leaves, 0x01 for interior nodes) prevents second-preimage
 * tricks between leaves and nodes. Environment-agnostic so a verifier in the
 * browser can check an inclusion proof against a published tree head.
 */
const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

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

/** Merkle tree hash of the given leaf hashes (MTH in RFC 6962 §2.1). */
export function computeRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array(0));
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return nodeHash(computeRoot(leaves.slice(0, k)), computeRoot(leaves.slice(k)));
}

/** Audit path for leaf `index` (PATH in RFC 6962 §2.1.1). */
export function inclusionProof(leaves: Uint8Array[], index: number): Uint8Array[] {
  if (index < 0 || index >= leaves.length) throw new RangeError("leaf index out of range");
  if (leaves.length === 1) return [];
  const k = split(leaves.length);
  if (index < k) {
    return [...inclusionProof(leaves.slice(0, k), index), computeRoot(leaves.slice(k))];
  }
  return [...inclusionProof(leaves.slice(k), index - k), computeRoot(leaves.slice(0, k))];
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
