import { sign } from "node:crypto";
import { bytesToHex } from "@/lib/base64";
import { getSigningKeyPair } from "@/lib/keys";
import type { LogStore } from "@/lib/log-store";
import { MerkleTree } from "@/lib/merkle";
import { logHeadMessage, type InclusionProofResponse, type SignedLogHead } from "@/lib/log-verify";

/**
 * Server-side production of signed tree heads and inclusion proofs.
 *
 * Each process keeps an incremental Merkle tree per log store. A request only
 * reads the leaf hashes appended since the last one (plus the last cached
 * leaf, to notice a log that was replaced underneath it), so a head costs two
 * small Redis reads and O(log n) hashing instead of a scan and re-encode of
 * every record. A cold process reads the leaf hashes once, in pages.
 */
const PAGE = 1000;

interface TreeState {
  tree: MerkleTree;
  /** Serialises catch-ups so two requests never append the same leaves twice. */
  queue: Promise<unknown>;
}

const states = new WeakMap<LogStore, TreeState>();

async function catchUp(state: TreeState, log: LogStore): Promise<number> {
  const size = await log.size();
  let tree = state.tree;
  if (size < tree.size) tree = new MerkleTree();

  // Re-read the last leaf we hold along with the new ones. If it no longer
  // matches, the store was reset or replaced (a dev memory store, a flushed
  // Redis) and the cached tree describes some other log.
  if (tree.size > 0) {
    const from = tree.size - 1;
    const batch = await log.leafHashes(from, Math.min(PAGE, size - from));
    if (batch.length === 0 || bytesToHex(batch[0]) !== bytesToHex(tree.leaf(from))) {
      tree = new MerkleTree();
    } else {
      for (const leaf of batch.slice(1)) tree.append(leaf);
    }
  }
  state.tree = tree;

  while (tree.size < size) {
    const batch = await log.leafHashes(tree.size, Math.min(PAGE, size - tree.size));
    if (batch.length === 0) throw new Error(`Transparency log leaf hashes end at ${tree.size}, expected ${size}`);
    for (const leaf of batch) tree.append(leaf);
  }
  return size;
}

/**
 * Bring the cached tree up to the log's current size and return it with that
 * size. The tree only grows, so later appends by other requests do not change
 * what `tree.root(size)` or a proof at `size` returns.
 */
export async function syncLogTree(log: LogStore): Promise<{ tree: MerkleTree; size: number }> {
  let state = states.get(log);
  if (!state) {
    state = { tree: new MerkleTree(), queue: Promise.resolve() };
    states.set(log, state);
  }
  const current = state;
  const run = current.queue.then(() => catchUp(current, log));
  current.queue = run.catch(() => undefined);
  const size = await run;
  return { tree: current.tree, size };
}

function signLogHead(tree: MerkleTree, size: number, timestamp: number): SignedLogHead {
  const root = bytesToHex(tree.root(size));
  const { privateKey, keyId } = getSigningKeyPair();
  const signature = sign(null, Buffer.from(logHeadMessage(size, root, timestamp), "utf8"), privateKey);
  return { size, root, timestamp, keyId, signature: signature.toString("base64url") };
}

export async function buildSignedLogHead(log: LogStore, timestamp: number = Date.now()): Promise<SignedLogHead> {
  const { tree, size } = await syncLogTree(log);
  return signLogHead(tree, size, timestamp);
}

/**
 * Inclusion proof plus a signed head computed from the same tree, so the
 * proof's root always matches a head the service has signed.
 */
export async function buildInclusionProof(log: LogStore, index: number): Promise<InclusionProofResponse | null> {
  const { tree, size } = await syncLogTree(log);
  if (index >= size) return null;
  const head = signLogHead(tree, size, Date.now());
  return {
    index,
    size,
    root: head.root,
    leafHash: bytesToHex(tree.leaf(index)),
    proof: tree.inclusionProof(index, size).map(bytesToHex),
    head,
  };
}
