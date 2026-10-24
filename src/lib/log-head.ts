import { sign } from "node:crypto";
import { bytesToHex } from "@/lib/base64";
import { getSigningKeyPair } from "@/lib/keys";
import type { LogStore } from "@/lib/log-store";
import { computeRoot, inclusionProof } from "@/lib/merkle";
import { encodeRecord } from "@/lib/record";
import { logHeadMessage, recordLeafHash, type InclusionProofResponse, type SignedLogHead } from "@/lib/log-verify";

/**
 * Server-side production of signed tree heads and inclusion proofs.
 *
 * The tree is rebuilt from the full log on each call. That is O(n) and fine
 * for the volumes this service sees; swap in a cached tree if the log grows
 * into the millions.
 */
const PAGE = 1000;

async function allLeaves(log: LogStore): Promise<Uint8Array[]> {
  const size = await log.size();
  const leaves: Uint8Array[] = [];
  for (let from = 0; from < size; from += PAGE) {
    const entries = await log.range(from, Math.min(PAGE, size - from));
    for (const record of entries) leaves.push(recordLeafHash(record));
  }
  return leaves;
}

export async function buildSignedLogHead(log: LogStore, timestamp: number = Date.now()): Promise<SignedLogHead> {
  const leaves = await allLeaves(log);
  const root = bytesToHex(computeRoot(leaves));
  const { privateKey, keyId } = getSigningKeyPair();
  const signature = sign(null, Buffer.from(logHeadMessage(leaves.length, root, timestamp), "utf8"), privateKey);
  return { size: leaves.length, root, timestamp, keyId, signature: signature.toString("base64url") };
}

export async function buildInclusionProof(log: LogStore, index: number): Promise<InclusionProofResponse | null> {
  const record = await log.get(index);
  if (!record) return null;
  const leaves = await allLeaves(log);
  if (index >= leaves.length) return null;
  return {
    index,
    size: leaves.length,
    root: bytesToHex(computeRoot(leaves)),
    leaf: encodeRecord(record),
    proof: inclusionProof(leaves, index).map(bytesToHex),
  };
}
