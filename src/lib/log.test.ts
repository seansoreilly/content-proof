import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyPair, stubServerKeys } from "@/test/fixtures";
import { createMemoryLogStore, type LogStore } from "@/lib/log-store";
import { computeRoot, leafHash, verifyInclusion } from "@/lib/merkle";
import { encodeRecord, type SignatureRecord } from "@/lib/record";
import { keyIdFromSpkiBase64, type PublicKeysJson } from "@/lib/keyset";
import { recordLeafHash, verifyInclusionProof, verifyLogHead } from "@/lib/log-verify";
import { bytesToHex, hexToBytes } from "@/lib/base64";

function rec(i: number): SignatureRecord {
  return {
    v: 2,
    k: "AbCdEfGhIjKlMnOp",
    h: "A".repeat(42) + "Q",
    e: `user${i}@example.com`,
    t: 1_760_000_000_000 + i,
    s: String.fromCharCode(65 + (i % 26)).repeat(86),
  };
}

describe("append-only log store", () => {
  it("assigns sequential indexes, serves ranges and finds entries by signature", async () => {
    const log = createMemoryLogStore();
    expect(await log.size()).toBe(0);
    expect(await log.append(rec(0))).toBe(0);
    expect(await log.append(rec(1))).toBe(1);
    expect(await log.append(rec(2))).toBe(2);
    expect(await log.size()).toBe(3);
    expect(await log.get(1)).toEqual(rec(1));
    expect(await log.get(5)).toBeNull();
    expect(await log.range(1, 10)).toEqual([rec(1), rec(2)]);
    expect(await log.indexOf(rec(2).s)).toBe(2);
    expect(await log.indexOf("Z".repeat(86))).toBeNull();
  });
});

describe("signed tree head", () => {
  beforeEach(() => vi.resetModules());

  it("signs the current root with the service key and verifies against published keys", async () => {
    const pair = stubServerKeys();
    const { buildSignedLogHead, buildInclusionProof } = await import("@/lib/log-head");
    const log = createMemoryLogStore();
    for (let i = 0; i < 5; i++) await log.append(rec(i));

    const head = await buildSignedLogHead(log);
    expect(head.size).toBe(5);
    expect(head.root).toMatch(/^[0-9a-f]{64}$/);

    const keyId = keyIdFromSpkiBase64(pair.publicKeyBase64);
    const keys: PublicKeysJson = {
      current: keyId,
      keys: { [keyId]: { keyId, algorithm: "Ed25519", publicKey: pair.publicKeyBase64 } },
    };
    expect(verifyLogHead(head, keys)).toBe(true);
    expect(verifyLogHead({ ...head, size: 6 }, keys)).toBe(false);
    expect(verifyLogHead({ ...head, root: "0".repeat(64) }, keys)).toBe(false);

    const other = makeKeyPair();
    const otherId = keyIdFromSpkiBase64(other.publicKeyBase64);
    const otherKeys: PublicKeysJson = {
      current: otherId,
      keys: { [otherId]: { keyId: otherId, algorithm: "Ed25519", publicKey: other.publicKeyBase64 } },
    };
    expect(verifyLogHead(head, otherKeys)).toBe(false);

    // Inclusion proof for entry 3 checks out against the same root
    const proof = await buildInclusionProof(log, 3);
    expect(proof).not.toBeNull();
    const leaf = leafHash(new TextEncoder().encode(encodeRecord(rec(3))));
    expect(proof!.leafHash).toBe(bytesToHex(leaf));
    expect(
      verifyInclusion(leaf, 3, proof!.size, proof!.proof.map(hexToBytes), hexToBytes(proof!.root))
    ).toBe(true);
    expect(proof!.root).toBe(head.root);
    expect(await buildInclusionProof(log, 99)).toBeNull();

    // The proof carries a signed head over the same tree
    expect(proof!.head.root).toBe(proof!.root);
    expect(proof!.head.size).toBe(proof!.size);
    expect(verifyLogHead(proof!.head, keys)).toBe(true);
    expect(verifyInclusionProof(rec(3), proof!, keys)).toBe(true);
    expect(verifyInclusionProof(rec(2), proof!, keys)).toBe(false);
    expect(verifyInclusionProof(rec(3), proof!, otherKeys)).toBe(false);
    // A head that does not match the proof's tree is refused
    expect(verifyInclusionProof(rec(3), { ...proof!, size: 6 }, keys)).toBe(false);
    expect(verifyInclusionProof(rec(3), { ...proof!, root: "0".repeat(64) }, keys)).toBe(false);
    expect(verifyInclusionProof(rec(3), { ...proof!, head: { ...proof!.head, size: 4 } }, keys)).toBe(false);
    expect(verifyInclusionProof(rec(3), { ...proof!, leafHash: "0".repeat(64) }, keys)).toBe(false);
  });
});

/** A store whose backing log can be swapped, counting the leaf-hash reads. */
function swappableLog(initial: LogStore) {
  const state = { inner: initial, reads: [] as Array<[number, number]> };
  const log: LogStore = {
    append: (r) => state.inner.append(r),
    size: () => state.inner.size(),
    get: (i) => state.inner.get(i),
    range: (f, c) => state.inner.range(f, c),
    indexOf: (s) => state.inner.indexOf(s),
    leafHashes: (f, c) => {
      state.reads.push([f, c]);
      return state.inner.leafHashes(f, c);
    },
  };
  return { log, state };
}

const rootOf = (records: SignatureRecord[]): string => bytesToHex(computeRoot(records.map(recordLeafHash)));

describe("incremental tree head", () => {
  beforeEach(() => vi.resetModules());

  it("reads only the leaves appended since the last head", async () => {
    stubServerKeys();
    const { buildSignedLogHead, buildInclusionProof } = await import("@/lib/log-head");
    const { log, state } = swappableLog(createMemoryLogStore());
    const records = Array.from({ length: 9 }, (_, i) => rec(i));

    for (const r of records.slice(0, 5)) await log.append(r);
    expect((await buildSignedLogHead(log)).root).toBe(rootOf(records.slice(0, 5)));
    expect(state.reads).toEqual([[0, 5]]);

    state.reads.length = 0;
    expect((await buildSignedLogHead(log)).size).toBe(5);
    // Just the last cached leaf, to check the log was not replaced.
    expect(state.reads).toEqual([[4, 1]]);

    for (const r of records.slice(5)) await log.append(r);
    state.reads.length = 0;
    const head = await buildSignedLogHead(log);
    expect(head).toMatchObject({ size: 9, root: rootOf(records) });
    expect(state.reads).toEqual([[4, 5]]);

    const proof = await buildInclusionProof(log, 7);
    expect(proof!.root).toBe(head.root);
    expect(proof!.leafHash).toBe(bytesToHex(recordLeafHash(rec(7))));
  });

  it("rebuilds when the log underneath was replaced or shrank", async () => {
    stubServerKeys();
    const { buildSignedLogHead } = await import("@/lib/log-head");
    const { log, state } = swappableLog(createMemoryLogStore());
    for (let i = 0; i < 4; i++) await log.append(rec(i));
    await buildSignedLogHead(log);

    // Same size, different entries.
    state.inner = createMemoryLogStore();
    const other = [10, 11, 12, 13].map(rec);
    for (const r of other) await log.append(r);
    expect((await buildSignedLogHead(log)).root).toBe(rootOf(other));

    // Shrank to two entries.
    state.inner = createMemoryLogStore();
    for (const r of other.slice(0, 2)) await log.append(r);
    expect(await buildSignedLogHead(log)).toMatchObject({ size: 2, root: rootOf(other.slice(0, 2)) });
  });

  it("does not double-append leaves when heads are requested concurrently", async () => {
    stubServerKeys();
    const { buildSignedLogHead } = await import("@/lib/log-head");
    const log = createMemoryLogStore();
    const records = Array.from({ length: 6 }, (_, i) => rec(i));
    for (const r of records) await log.append(r);
    const heads = await Promise.all(Array.from({ length: 5 }, () => buildSignedLogHead(log)));
    for (const head of heads) expect(head).toMatchObject({ size: 6, root: rootOf(records) });
  });
});
