import { sign } from "node:crypto";
import { bytesToHex } from "@/lib/base64";
import { getSigningKeyPair } from "@/lib/keys";
import type { LogStore } from "@/lib/log-store";
import { computeRoot, inclusionProof } from "@/lib/merkle";
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

function signLogHead(leaves: Uint8Array[], timestamp: number): SignedLogHead {
  const root = bytesToHex(computeRoot(leaves));
  const { privateKey, keyId } = getSigningKeyPair();
  const signature = sign(null, Buffer.from(logHeadMessage(leaves.length, root, timestamp), "utf8"), privateKey);
  return { size: leaves.length, root, timestamp, keyId, signature: signature.toString("base64url") };
}

export async function buildSignedLogHead(log: LogStore, timestamp: number = Date.now()): Promise<SignedLogHead> {
  return signLogHead(await allLeaves(log), timestamp);
}

/**
 * Inclusion proof plus a signed head computed from the same leaves, so the
 * proof's root always matches a head the service has signed.
 */
export async function buildInclusionProof(log: LogStore, index: number): Promise<InclusionProofResponse | null> {
  const leaves = await allLeaves(log);
  if (index >= leaves.length) return null;
  const head = signLogHead(leaves, Date.now());
  return {
    index,
    size: head.size,
    root: head.root,
    leafHash: bytesToHex(leaves[index]),
    proof: inclusionProof(leaves, index).map(bytesToHex),
    head,
  };
}
