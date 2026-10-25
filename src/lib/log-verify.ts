import { bytesToHex, hexToBytes, utf8ToBytes } from "@/lib/base64";
import { verifyEd25519 } from "@/lib/crypto/verify";
import { findPublicKey, type PublicKeysJson } from "@/lib/keyset";
import { leafHash, verifyInclusion } from "@/lib/merkle";
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

export const LOG_HEAD_DOMAIN = "contentproof-log/v1";

export function logHeadMessage(size: number, rootHex: string, timestamp: number): string {
  return `${LOG_HEAD_DOMAIN}\n${size}\n${rootHex}\n${timestamp}`;
}

export function verifyLogHead(head: SignedLogHead, keys: PublicKeysJson): boolean {
  const entry = findPublicKey(keys, head.keyId);
  if (!entry) return false;
  if (!Number.isInteger(head.size) || head.size < 0 || !/^[0-9a-f]{64}$/.test(head.root)) return false;
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
