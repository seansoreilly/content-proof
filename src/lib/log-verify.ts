import { bytesToHex, hexToBytes, utf8ToBytes } from "@/lib/base64";
import { verifyEd25519 } from "@/lib/crypto/verify";
import { findPublicKey, type PublicKeysJson } from "@/lib/keyset";
import { leafHash, verifyConsistency, verifyInclusion } from "@/lib/merkle";
import { encodeRecord, type SignatureRecord } from "@/lib/record";

/**
 * Browser-safe verification of the transparency log's signed tree head and
 * inclusion proofs. Anyone can archive tree heads over time and later prove
 * the log was append-only and that a given record was in it.
 */
export interface SignedLogHead {
  /** Number of entries covered by `root`. */
  size: number;
  /** Merkle root, hex. */
  root: string;
  /** When the head was produced, ms since epoch. */
  timestamp: number;
  keyId: string;
  /** base64url Ed25519 signature over `logHeadMessage(...)`. */
  signature: string;
}

export interface InclusionProofResponse {
  index: number;
  size: number;
  root: string;
  /** Merkle leaf hash of the record, hex: SHA-256(0x00 || encoded record). */
  leafHash: string;
  /** Audit path, hex, leaf-to-root order. */
  proof: string[];
  /** Signed tree head over the very tree `root` and `proof` belong to. */
  head: SignedLogHead;
}

export interface ConsistencyProofResponse {
  /** Size of the older tree. */
  from: number;
  /** Size of the newer tree, always the log's size when the proof was made. */
  to: number;
  /** RFC 6962 consistency proof, hex. Empty when `from` is 0 or equals `to`. */
  proof: string[];
  /** Signed tree head of size `to`, the root the proof leads to. */
  head: SignedLogHead;
}

export const LOG_HEAD_DOMAIN = "contentproof-log/v1";

/** A SHA-256 hash as lowercase hex: tree roots and proof nodes. */
const HASH_HEX = /^[0-9a-f]{64}$/;

export function logHeadMessage(size: number, rootHex: string, timestamp: number): string {
  return `${LOG_HEAD_DOMAIN}\n${size}\n${rootHex}\n${timestamp}`;
}

export function verifyLogHead(head: SignedLogHead, keys: PublicKeysJson): boolean {
  const entry = findPublicKey(keys, head.keyId);
  if (!entry) return false;
  if (!Number.isInteger(head.size) || head.size < 0 || !HASH_HEX.test(head.root)) return false;
  return verifyEd25519(logHeadMessage(head.size, head.root, head.timestamp), head.signature, entry.publicKey);
}

export function recordLeafHash(record: SignatureRecord): Uint8Array {
  return leafHash(utf8ToBytes(encodeRecord(record)));
}

/** Check that `record` sits at `proof.index` in the tree whose root is `proof.root`. */
export function verifyRecordInclusion(record: SignatureRecord, proof: InclusionProofResponse): boolean {
  try {
    const leaf = recordLeafHash(record);
    if (bytesToHex(leaf) !== proof.leafHash) return false;
    return verifyInclusion(leaf, proof.index, proof.size, proof.proof.map(hexToBytes), hexToBytes(proof.root));
  } catch {
    return false;
  }
}

/**
 * Full check of an inclusion proof: the audit path reaches `proof.root`, and
 * `proof.head` is a genuine service-signed head for exactly that tree.
 */
export function verifyInclusionProof(
  record: SignatureRecord,
  proof: InclusionProofResponse,
  keys: PublicKeysJson
): boolean {
  try {
    return (
      verifyRecordInclusion(record, proof) &&
      verifyLogHead(proof.head, keys) &&
      proof.head.size === proof.size &&
      proof.head.root === proof.root
    );
  } catch {
    return false;
  }
}


/**
 * Check that the log only grew between two signed heads: both signatures are
 * genuine and `proof` shows the older tree is a prefix of the newer one. This
 * is what turns archived heads into evidence: a service that rewrote, removed
 * or reordered an entry covered by `oldHead` cannot produce such a proof.
 * Both heads' keys must be in `keys`: published key sets keep retired keys
 * listed, so archived heads stay checkable after a rotation.
 */
export function verifyLogConsistency(
  oldHead: SignedLogHead,
  newHead: SignedLogHead,
  proof: string[],
  keys: PublicKeysJson
): boolean {
  try {
    if (!Array.isArray(proof) || !proof.every((p) => typeof p === "string" && HASH_HEX.test(p))) return false;
    return (
      verifyLogHead(oldHead, keys) &&
      verifyLogHead(newHead, keys) &&
      verifyConsistency(
        oldHead.size,
        newHead.size,
        hexToBytes(oldHead.root),
        hexToBytes(newHead.root),
        proof.map(hexToBytes)
      )
    );
  } catch {
    return false;
  }
}

/**
 * Check a `/api/log/consistency` response against a head the caller already
 * holds (one archived earlier, say): the response must start at that head's
 * size, and its fresh head must be signed and consistent with it.
 */
export function verifyConsistencyResponse(
  oldHead: SignedLogHead,
  response: ConsistencyProofResponse,
  keys: PublicKeysJson
): boolean {
  try {
    return (
      response.from === oldHead.size &&
      response.to === response.head.size &&
      verifyLogConsistency(oldHead, response.head, response.proof, keys)
    );
  } catch {
    return false;
  }
}
