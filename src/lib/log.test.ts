import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyPair, stubServerKeys } from "@/test/fixtures";
import { createMemoryLogStore } from "@/lib/log-store";
import { leafHash, verifyInclusion } from "@/lib/merkle";
import { encodeRecord, type SignatureRecord } from "@/lib/record";
import { keyIdFromSpkiBase64, type PublicKeysJson } from "@/lib/keyset";
import { verifyLogHead } from "@/lib/log-verify";
import { hexToBytes } from "@/lib/base64";

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
    expect(
      verifyInclusion(leaf, 3, proof!.size, proof!.proof.map(hexToBytes), hexToBytes(proof!.root))
    ).toBe(true);
    expect(proof!.root).toBe(head.root);
    expect(await buildInclusionProof(log, 99)).toBeNull();
  });
});
